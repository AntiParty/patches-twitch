import logger from '../util/logger';
import { toInboundChatMessage } from '../chat/eventSubChatAdapter';
import { channelsOnTransport, getActiveTransport, setActiveTransport } from '../chat/activeTransport';
import { broadcasterIdFor } from '../chat/chatPresence';
import { createChatRevocationHandler } from '../chat/chatTransportSwitch';
import type { InboundChatMessage } from '../chat/inboundChatMessage';
import type { Channel } from '../db';
import type { ConduitApi } from './conduitApi';
import { startConduitShard, type ConduitShardOptions } from './conduitShard';
import { createConduitOutageMonitor, type ConduitOutageMonitor } from './conduitOutageMonitor';
import { createSubscriptionRegistry } from './subscriptionRegistry';
import type { NotificationHandler } from './types';

const SHARD_IDS = ['0', '1'];
export const CONDUIT_SHARD_COUNT = SHARD_IDS.length;
const DEDUPE_LIMIT = 1000;
const DEFAULT_FALLBACK_AFTER_MS = 300000;

/** A bounded seen-set of message ids, shared by every shard so a redelivery on the other shard is dropped. */
export function createMessageDeduper(limit = DEDUPE_LIMIT): (messageId: string) => boolean {
  const seen = new Set<string>();
  return (id) => {
    if (seen.has(id)) return true;
    seen.add(id);
    if (seen.size > limit) seen.delete(seen.values().next().value as string);
    return false;
  };
}

/** Unset or empty means the 5 minute default; only an explicit '0' disables the fallback. */
export function parseFallbackAfterMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_FALLBACK_AFTER_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_FALLBACK_AFTER_MS;
}

type Registry = ReturnType<typeof createSubscriptionRegistry>;

interface RuntimeLog {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

// Everything below that touches the DB (twitchEventSubWs, botManager, ircBot, Discord) loads lazily,
// so importing this module stays cheap and unit tests need no database.
const lazy = {
  botManager: () => (require('../botManager') as typeof import('../botManager')).botManager,
  eventSubWs: () => require('../util/twitchEventSubWs') as typeof import('../util/twitchEventSubWs'),
  discord: () => require('../handlers/discordHandler') as typeof import('../handlers/discordHandler'),
  dispatch: () => require('../chat/dispatchChatMessage') as typeof import('../chat/dispatchChatMessage'),
  ircBot: () => require('../util/ircBot') as typeof import('../util/ircBot'),
  twitchUtils: () => require('../util/twitchUtils') as typeof import('../util/twitchUtils'),
};

export function createNotificationRouter(deps: {
  dispatch: (msg: InboundChatMessage, commandHandler: Record<string, any>) => Promise<void>;
  getCommandHandler(): Record<string, any>;
  onStreamOnline(name: string, id: string): Promise<void>;
  onStreamOffline(name: string, id: string): Promise<void>;
  onRedemption(event: any): Promise<void>;
  onShardDisabled(event: any): Promise<void>;
}): NotificationHandler {
  return async (type, event, meta) => {
    switch (type) {
      case 'channel.chat.message': {
        const msg = toInboundChatMessage(event, meta.message_timestamp);
        if (msg) await deps.dispatch(msg, deps.getCommandHandler());
        break;
      }
      case 'stream.online':
        await deps.onStreamOnline(event.broadcaster_user_name, event.broadcaster_user_id);
        break;
      case 'stream.offline':
        await deps.onStreamOffline(event.broadcaster_user_name, event.broadcaster_user_id);
        break;
      case 'channel.channel_points_custom_reward_redemption.add':
        await deps.onRedemption(event);
        break;
      case 'conduit.shard.disabled':
        await deps.onShardDisabled(event);
        break;
      default:
        break;
    }
  };
}

export interface ConduitRuntime {
  registry: Registry;
  shardsAssigned(): number;
  reconnects(): number;
  onShardStateChange(cb: (assigned: number) => void): void;
  /** Resolves once the shard count is set and the shards are started. */
  started: Promise<void>;
  /** Set by startConduitRuntime; absent on bare runtimes. */
  outageMonitor?: ConduitOutageMonitor;
}

export function createConduitRuntime(deps: {
  conduitId: string;
  api: Pick<ConduitApi, 'setShardCount' | 'assignWebSocketShard'>;
  registry: Registry;
  onNotification: NotificationHandler;
  onRevocation: ConduitShardOptions['onRevocation'];
  startShard?: typeof startConduitShard;
  log?: RuntimeLog;
}): ConduitRuntime {
  const log = deps.log ?? logger;
  const startShard = deps.startShard ?? startConduitShard;
  const shards: Array<ReturnType<typeof startConduitShard>> = [];
  const listeners: Array<(assigned: number) => void> = [];
  const isDuplicate = createMessageDeduper();
  const shardsAssigned = () => shards.filter((s) => s.isAssigned()).length;

  const started = (async () => {
    try {
      await deps.api.setShardCount(deps.conduitId, SHARD_IDS.length);
    } catch (err: any) {
      log.error(`[Conduit] Could not set shard count to ${SHARD_IDS.length}: ${err?.message || err}`);
    }
    for (const shardId of SHARD_IDS) {
      shards.push(
        startShard({
          conduitId: deps.conduitId,
          shardId,
          api: deps.api,
          onNotification: deps.onNotification,
          onRevocation: deps.onRevocation,
          isDuplicate,
          onStateChange: () => {
            const assigned = shardsAssigned();
            for (const cb of listeners) cb(assigned);
          },
        }),
      );
    }
    log.info(`[Conduit] Started ${shards.length} shards on conduit ${deps.conduitId}`);
  })();

  return {
    registry: deps.registry,
    shardsAssigned,
    reconnects: () => shards.reduce((sum, s) => sum + s.reconnectCount(), 0),
    onShardStateChange: (cb) => {
      listeners.push(cb);
    },
    started,
  };
}

let runtime: ConduitRuntime | null = null;

/** Starts the conduit shards. Returns null (and does nothing) when EVENTSUB_CONDUIT_ID is unset. */
export function startConduitRuntime(): ConduitRuntime | null {
  if (runtime) return runtime;
  const conduitId = process.env.EVENTSUB_CONDUIT_ID?.trim();
  if (!conduitId) return null;

  const { conduitApi } = require('./conduitApiInstance') as typeof import('./conduitApiInstance');
  const registry = createSubscriptionRegistry({
    api: conduitApi,
    conduitId,
    clientId: process.env.TWITCH_CLIENT_ID || '',
  });

  const onNotification = createNotificationRouter({
    dispatch: (msg, handler) => lazy.dispatch().dispatchChatMessage(msg, handler),
    getCommandHandler: () => lazy.botManager().getCommandHandler(),
    onStreamOnline: (name, id) => lazy.eventSubWs().handleStreamOnline(name, id),
    onStreamOffline: (name, id) => lazy.eventSubWs().handleStreamOffline(name, id),
    onRedemption: (event) => lazy.eventSubWs().handleRedemptionAdd(event),
    onShardDisabled: async (event) => {
      logger.error(`[Conduit] Shard ${event?.shard_id} disabled: ${event?.status}`);
      await lazy
        .discord()
        .sendWarningToDiscord('EventSub conduit shard disabled', `shard ${event?.shard_id}: ${event?.status}`);
    },
  });

  const revocationHandler = createChatRevocationHandler({
    registry,
    startChatBot: (username) => lazy.botManager().startIrcFallback(username),
    setActiveTransport,
    sendWarningToDiscord: (title, details) => lazy.discord().sendWarningToDiscord(title, details),
  });

  runtime = createConduitRuntime({
    conduitId,
    api: conduitApi,
    registry,
    onNotification,
    onRevocation: (subscription) => {
      revocationHandler(subscription).catch((err) =>
        logger.error(`[Conduit] Revocation handling failed: ${err?.message || err}`),
      );
    },
  });

  const outageMonitor = createConduitOutageMonitor({
    shardsAssigned: () => runtime!.shardsAssigned(),
    eventsubChannels: () => channelsOnTransport('eventsub'),
    startIrc: (u) => lazy.botManager().startIrcFallback(u),
    stopIrc: (u) => lazy.ircBot().stopChatBot(u, true),
    setActiveTransport,
    warn: (t, b) => lazy.discord().sendWarningToDiscord(t, b),
    now: Date.now,
    refreshChatState: () => registry.refresh(),
    broadcasterIdFor,
    isChatSubActive: (_username, id) => Boolean(id && registry.isChatActive(id)),
    getActiveTransport,
    fallbackAfterMs: parseFallbackAfterMs(process.env.EVENTSUB_FALLBACK_AFTER_MS),
  });
  runtime.outageMonitor = outageMonitor;
  let ticking = false;
  setInterval(() => {
    if (ticking) return;
    ticking = true;
    outageMonitor
      .tick()
      .catch((err) => logger.error(`[Conduit] Outage monitor tick failed: ${err?.message || err}`))
      .finally(() => {
        ticking = false;
      });
  }, 15000);
  return runtime;
}

export function getConduitRuntime(): ReturnType<typeof startConduitRuntime> {
  return runtime;
}

const usesConduit = (channel: Channel) => Boolean(runtime) && channel.chat_transport === 'eventsub';

/**
 * Stream and redemption event plumbing for a channel. Conduit channels use the shared conduit;
 * everything else (including eventsub channels while the runtime is off) keeps its per-user socket.
 */
export const channelEvents = {
  async subscribeRedemption(channel: Channel, rewardId: string): Promise<void> {
    const broadcasterId = String(channel.twitch_user_id || '');
    if (!broadcasterId) return;
    try {
      if (usesConduit(channel)) {
        await runtime!.registry.addRedemption(broadcasterId, rewardId);
        return;
      }
      const token = lazy.twitchUtils().decryptChannelAccessToken(channel);
      if (token) lazy.eventSubWs().addRedemptionSubscription(broadcasterId, token, broadcasterId, rewardId);
    } catch (err: any) {
      logger.warn(`[Conduit] Could not subscribe redemption ${rewardId} for ${channel.username}: ${err?.message || err}`);
    }
  },

  async unsubscribeRedemption(channel: Channel, rewardId: string): Promise<void> {
    const broadcasterId = String(channel.twitch_user_id || '');
    if (!broadcasterId) return;
    if (usesConduit(channel)) {
      await runtime!.registry.removeRedemption(broadcasterId, rewardId);
      return;
    }
    await lazy.eventSubWs().removeRedemptionSubscription(broadcasterId, rewardId);
  },

  /** Drops every subscription for a removed channel. */
  async removeAll(channel: Channel): Promise<void> {
    const broadcasterId = String(channel.twitch_user_id || '');
    if (!broadcasterId) return;
    if (usesConduit(channel)) await runtime!.registry.removeChannel(broadcasterId);
    // A channel that fell back to IRC may still own a per-user socket.
    lazy.eventSubWs().removeUserWebSocket(broadcasterId);
  },
};
