import WebSocket from 'ws';
import logger from '../util/logger';
import type { ConduitApi } from './conduitApi';
import type { NotificationHandler, WebSocketLike } from './types';

const DEFAULT_URL = 'wss://eventsub.wss.twitch.tv/ws';
const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const KEEPALIVE_GRACE_S = 5;
const WELCOME_TIMEOUT_MS = 15000;
const DEDUPE_LIMIT = 1000;

export interface ShardTimers {
  setTimeout(fn: () => void, ms: number): any;
  clearTimeout(h: any): void;
  now(): number;
}

export interface ShardEvent {
  type: string;
  severity?: 'info' | 'warning' | 'critical';
  reasonCode?: string | null;
}

export interface ConduitShardOptions {
  conduitId: string;
  shardId: string;
  api: Pick<ConduitApi, 'assignWebSocketShard'>;
  onNotification: NotificationHandler;
  createSocket?: (url: string) => WebSocketLike;
  onStateChange?: (state: 'assigned' | 'unassigned') => void;
  timers?: ShardTimers;
  recordEvent?: (event: ShardEvent) => Promise<void>;
}

const defaultTimers: ShardTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h),
  now: () => Date.now(),
};

// Loaded lazily so importing this module never pulls in the DB (unit tests inject recordEvent).
async function defaultRecordEvent(event: ShardEvent): Promise<void> {
  const { recordOperationalEvent } = await import('../services/operationalEvents.service');
  await recordOperationalEvent(event);
}

export function startConduitShard(opts: ConduitShardOptions): {
  stop(): void;
  isAssigned(): boolean;
  reconnectCount(): number;
} {
  const timers = opts.timers ?? defaultTimers;
  const createSocket = opts.createSocket ?? ((url: string) => new WebSocket(url) as unknown as WebSocketLike);
  const recordEvent = opts.recordEvent ?? defaultRecordEvent;

  let stopped = false;
  let current: WebSocketLike | null = null;
  let pending: WebSocketLike | null = null; // reconnect socket awaiting its welcome
  let sessionId: string | null = null; // session of `current` once welcomed
  let assigned = false;
  let connectedRecorded = false;
  let reconnects = 0;
  let backoff = MIN_BACKOFF_MS;
  let keepaliveMs = (10 + KEEPALIVE_GRACE_S) * 1000;
  let keepaliveTimer: any = null;
  let reconnectTimer: any = null;
  const seen = new Set<string>();

  const record = (event: ShardEvent) => {
    recordEvent(event).catch((err) => logger.warn(`[Conduit] Failed to record event ${event.type}: ${err?.message || err}`));
  };

  function setAssigned(value: boolean) {
    if (assigned === value) return;
    assigned = value;
    opts.onStateChange?.(value ? 'assigned' : 'unassigned');
  }

  function clearKeepalive() {
    if (keepaliveTimer !== null) {
      timers.clearTimeout(keepaliveTimer);
      keepaliveTimer = null;
    }
  }

  function armWatchdog(ms: number, reason: string) {
    clearKeepalive();
    keepaliveTimer = timers.setTimeout(() => {
      keepaliveTimer = null;
      logger.warn(`[Conduit] Shard ${opts.shardId}: ${reason}; reconnecting`);
      dropCurrent(reason);
    }, ms);
  }

  function discard(sock: WebSocketLike | null) {
    if (!sock) return;
    sock.removeAllListeners();
    // Swallow late errors on a socket we no longer track.
    sock.on('error', () => {});
    try {
      sock.close();
    } catch {
      /* already closed */
    }
  }

  /** The current connection is gone or unusable: tear down and schedule a fresh connect. */
  function dropCurrent(reason: string) {
    clearKeepalive();
    const sock = current;
    current = null;
    sessionId = null;
    discard(sock);
    // The pending reconnect socket (if any) is tied to a session that is going away too.
    discard(pending);
    pending = null;
    setAssigned(false);
    if (connectedRecorded) {
      connectedRecorded = false;
      record({ type: 'eventsub_conduit_disconnected', severity: 'warning', reasonCode: reason.slice(0, 64) });
    }
    scheduleReconnect();
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer !== null) return;
    const delay = backoff;
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    reconnectTimer = timers.setTimeout(() => {
      reconnectTimer = null;
      if (stopped) return;
      reconnects++;
      connectFresh();
    }, delay);
  }

  function wire(sock: WebSocketLike) {
    sock.on('message', (raw: any) => onMessage(sock, raw));
    sock.on('close', () => onClose(sock));
    sock.on('error', (err: any) => {
      logger.warn(`[Conduit] Shard ${opts.shardId} socket error: ${err?.message || err}`);
    });
  }

  function connectFresh() {
    const sock = createSocket(DEFAULT_URL);
    current = sock;
    sessionId = null;
    wire(sock);
    armWatchdog(WELCOME_TIMEOUT_MS, 'no session_welcome received');
  }

  function onClose(sock: WebSocketLike) {
    if (stopped) return;
    if (sock === pending) {
      // Reconnect socket died before its welcome; the old one stays until Twitch closes it.
      logger.warn(`[Conduit] Shard ${opts.shardId}: reconnect socket closed before welcome`);
      pending = null;
      return;
    }
    if (sock !== current) return;
    logger.warn(`[Conduit] Shard ${opts.shardId}: socket closed`);
    dropCurrent('socket closed');
  }

  function onMessage(sock: WebSocketLike, raw: any) {
    if (stopped) return;
    if (sock !== current && sock !== pending) return;
    let msg: any;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
    } catch {
      logger.warn('[Conduit] Ignoring non-JSON websocket message');
      return;
    }
    const meta = msg?.metadata;
    const payload = msg?.payload;
    if (!meta) return;

    if (sock === current && meta.message_type !== 'session_welcome') {
      armWatchdog(keepaliveMs, 'keepalive missed');
    }

    switch (meta.message_type) {
      case 'session_welcome':
        onWelcome(sock, payload);
        break;
      case 'session_keepalive':
        break;
      case 'notification':
        onNotification(meta, payload);
        break;
      case 'session_reconnect':
        if (sock === current) onReconnect(payload);
        break;
      case 'revocation':
        logger.warn(
          `[Conduit] Subscription revoked: type=${payload?.subscription?.type} id=${payload?.subscription?.id} status=${payload?.subscription?.status}`
        );
        break;
      default:
        break;
    }
  }

  function onWelcome(sock: WebSocketLike, payload: any) {
    const id: string | undefined = payload?.session?.id;
    if (!id) {
      logger.warn('[Conduit] session_welcome without a session id');
      return;
    }
    keepaliveMs = ((payload.session.keepalive_timeout_seconds ?? 10) + KEEPALIVE_GRACE_S) * 1000;

    if (sock === pending) {
      // Handoff: the new socket becomes current first, then the old one is closed silently.
      const old = current;
      current = sock;
      pending = null;
      discard(old);
    }
    sessionId = id;
    setAssigned(false);
    armWatchdog(keepaliveMs, 'keepalive missed');

    // Reassign on every welcome (including a reconnect socket); the PATCH is idempotent.
    opts.api.assignWebSocketShard(opts.conduitId, opts.shardId, id).then(
      () => {
        if (stopped || current !== sock || sessionId !== id) return;
        backoff = MIN_BACKOFF_MS;
        setAssigned(true);
        if (!connectedRecorded) {
          connectedRecorded = true;
          record({ type: 'eventsub_conduit_connected', severity: 'info' });
        }
        logger.info(`[Conduit] Shard ${opts.shardId} assigned to session ${id}`);
      },
      (err) => {
        if (stopped || current !== sock || sessionId !== id) return;
        logger.error(`[Conduit] Shard ${opts.shardId} assignment failed: ${err?.message || err}`);
        dropCurrent('assignment failed');
      }
    );
  }

  function onNotification(meta: any, payload: any) {
    const id: string = meta.message_id;
    if (id) {
      if (seen.has(id)) return;
      seen.add(id);
      if (seen.size > DEDUPE_LIMIT) {
        const oldest = seen.values().next().value as string;
        seen.delete(oldest);
      }
    }
    const type = payload?.subscription?.type ?? meta.subscription_type;
    const fail = (err: any) =>
      logger.error(`[Conduit] Notification handler failed for ${type}: ${err?.message || err}`);
    try {
      opts
        .onNotification(type, payload?.event, { message_id: id, message_timestamp: meta.message_timestamp })
        .catch(fail);
    } catch (err) {
      fail(err);
    }
  }

  function onReconnect(payload: any) {
    const url: string | undefined = payload?.session?.reconnect_url;
    if (!url) {
      logger.warn('[Conduit] session_reconnect without a reconnect_url');
      return;
    }
    logger.info(`[Conduit] Shard ${opts.shardId}: session_reconnect, opening new socket`);
    discard(pending);
    reconnects++;
    pending = createSocket(url);
    wire(pending);
  }

  connectFresh();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearKeepalive();
      if (reconnectTimer !== null) {
        timers.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      discard(current);
      discard(pending);
      current = null;
      pending = null;
      sessionId = null;
      setAssigned(false);
      if (connectedRecorded) {
        connectedRecorded = false;
        record({ type: 'eventsub_conduit_disconnected', severity: 'warning', reasonCode: 'stopped' });
      }
    },
    isAssigned: () => assigned,
    reconnectCount: () => reconnects,
  };
}
