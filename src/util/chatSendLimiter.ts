import logger from './logger';

/**
 * Per-channel outbound chat limiter for Helix Send Chat Message.
 *
 * Twitch allows 20 messages per 30s per channel, or 100 when the sender is a moderator,
 * VIP or the broadcaster there. Sends for one (broadcaster, sender) pair run one at a time
 * in order, wait for room in a sliding 30s window, and back off until Ratelimit-Reset on 429.
 */

const WINDOW_MS = 30_000;
const NORMAL_LIMIT = 20;
const ELEVATED_LIMIT = 100;
const MAX_PENDING = 30;
const MAX_429_WAIT_MS = 60_000;

export interface ChatSendLimiterOptions {
  windowMs?: number;
  normalLimit?: number;
  elevatedLimit?: number;
  maxPending?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface Lane {
  sent: number[]; // send timestamps inside the window, oldest first
  tail: Promise<unknown>;
  pending: number;
  pausedUntil: number;
}

export class ChatQueueFullError extends Error {
  constructor(key: string) {
    super(`Chat send queue full for ${key}`);
    this.name = 'ChatQueueFullError';
  }
}

/** Epoch-seconds `Ratelimit-Reset` header of an axios 429, as a wait in ms. */
export function retryAfterMs(err: any, now: number): number | null {
  if (err?.response?.status !== 429) return null;
  const headers = err.response.headers ?? {};
  const reset = Number(headers['ratelimit-reset'] ?? headers['Ratelimit-Reset']);
  if (!Number.isFinite(reset) || reset <= 0) return 1000;
  return Math.min(MAX_429_WAIT_MS, Math.max(0, reset * 1000 - now));
}

export function createChatSendLimiter(opts: ChatSendLimiterOptions = {}) {
  const windowMs = opts.windowMs ?? WINDOW_MS;
  const normalLimit = opts.normalLimit ?? NORMAL_LIMIT;
  const elevatedLimit = opts.elevatedLimit ?? ELEVATED_LIMIT;
  const maxPending = opts.maxPending ?? MAX_PENDING;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const lanes = new Map<string, Lane>();
  const elevated = new Set<string>();
  const keyOf = (broadcasterId: string, senderId: string) => `${broadcasterId}:${senderId}`;

  const lane = (key: string): Lane => {
    let l = lanes.get(key);
    if (!l) lanes.set(key, (l = { sent: [], tail: Promise.resolve(), pending: 0, pausedUntil: 0 }));
    return l;
  };

  async function waitForRoom(key: string, l: Lane) {
    for (;;) {
      const t = now();
      while (l.sent.length && l.sent[0] <= t - windowMs) l.sent.shift();
      const limit = elevated.has(key) ? elevatedLimit : normalLimit;
      const pauseWait = l.pausedUntil - t;
      const windowWait = l.sent.length >= limit ? l.sent[0] + windowMs - t : 0;
      const wait = Math.max(pauseWait, windowWait);
      if (wait <= 0) return;
      await sleep(wait);
    }
  }

  async function attempt<T>(key: string, l: Lane, send: () => Promise<T>, retried: boolean): Promise<T> {
    await waitForRoom(key, l);
    l.sent.push(now());
    try {
      return await send();
    } catch (err) {
      const wait = retryAfterMs(err, now());
      if (wait === null || retried) throw err;
      logger.warn(`[ChatLimiter] 429 for ${key}, pausing ${wait}ms before one retry`);
      l.pausedUntil = now() + wait;
      return attempt(key, l, send, true);
    }
  }

  return {
    /** Runs `send` once there is room for this sender in this channel. Rejects with ChatQueueFullError when backed up. */
    run<T>(broadcasterId: string, senderId: string, send: () => Promise<T>): Promise<T> {
      const key = keyOf(broadcasterId, senderId);
      const l = lane(key);
      if (l.pending >= maxPending) return Promise.reject(new ChatQueueFullError(key));
      l.pending++;
      const result = l.tail.then(() => attempt(key, l, send, false));
      l.tail = result
        .catch(() => undefined)
        .finally(() => {
          l.pending--;
          if (l.pending === 0 && !l.sent.length) lanes.delete(key);
        });
      return result;
    },

    /** Records whether the sender is a mod/VIP/broadcaster in the channel (raises its limit). */
    setElevated(broadcasterId: string, senderId: string, isElevated: boolean) {
      const key = keyOf(broadcasterId, senderId);
      if (isElevated) elevated.add(key);
      else elevated.delete(key);
    },

    isElevated: (broadcasterId: string, senderId: string) => elevated.has(keyOf(broadcasterId, senderId)),
    pending: (broadcasterId: string, senderId: string) => lanes.get(keyOf(broadcasterId, senderId))?.pending ?? 0,
  };
}

export type ChatSendLimiter = ReturnType<typeof createChatSendLimiter>;

export const chatSendLimiter = createChatSendLimiter();

const ELEVATED_BADGES = ['broadcaster', 'moderator', 'vip', 'lead_moderator'];

/** True when IRC-style tags show the chatter is a broadcaster, mod or VIP. */
export function hasElevatedBadge(tags: Record<string, any>): boolean {
  if (tags?.mod === '1') return true;
  const badges = String(tags?.badges ?? '');
  return badges.split(',').some((b) => ELEVATED_BADGES.includes(b.split('/')[0]));
}
