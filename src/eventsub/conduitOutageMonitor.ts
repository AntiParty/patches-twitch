import logger from '../util/logger';
import { mapWithConcurrency } from '../util/concurrency';
import { recordEventSubFallback } from '../chat/chatTransportSwitch';

export const WARN_AFTER_MS = 120000;
export const RECOVER_AFTER_MS = 60000;
const FALLBACK_CONCURRENCY = 5;

export type OutageState = 'healthy' | 'warned' | 'fallen_back';

export interface OutageMonitorDeps {
  shardsAssigned(): number;
  /** Channels whose chat is currently active on eventsub. */
  eventsubChannels(): string[];
  /** Starts IRC for the channel; resolves true once authenticated. */
  startIrc(username: string): Promise<boolean>;
  stopIrc(username: string): Promise<void>;
  setActiveTransport(username: string, t: 'irc' | 'eventsub'): void;
  warn(title: string, body: string): Promise<void>;
  now(): number;
  /** Re-reads the conduit's subscriptions so the registry cache reflects any revocation missed during the outage. */
  refreshChatState?(): Promise<void>;
  /** True when the channel's conduit chat subscription is enabled; gets the broadcaster id captured at fallback time. */
  isChatSubActive?(username: string, broadcasterId: string | null): boolean;
  /** The channel's broadcaster id, captured before the fallback flips it; used to find its chat sub later. */
  broadcasterIdFor?(username: string): string | null;
  /** The channel's current active transport. */
  getActiveTransport?(username: string): 'irc' | 'eventsub';
  /** 0 disables the IRC fallback (the warning still fires). */
  fallbackAfterMs: number;
}

/**
 * Watches the conduit shards. With no shard assigned it warns, then moves the active eventsub
 * channels to IRC; once a shard has been stable it moves back only the channels it moved.
 */
export function createConduitOutageMonitor(deps: OutageMonitorDeps) {
  let state: OutageState = 'healthy';
  let warned = false;
  let downSince: number | null = null;
  let upSince: number | null = null;
  let fallbacks = 0;
  let busy = false;
  const moved = new Set<string>();
  const subIds = new Map<string, string>(); // username -> broadcaster id, captured before the gate flips

  const safeWarn = async (title: string, body: string) => {
    try {
      await deps.warn(title, body);
    } catch (err: any) {
      logger.error(`[Conduit] Could not send "${title}" warning: ${err?.message || err}`);
    }
  };

  const fallBack = async (firstPass: boolean) => {
    // Re-runs every tick while fallen back: picks up channels that landed on eventsub mid-outage
    // and channels whose IRC start failed earlier.
    const channels = deps.eventsubChannels().filter((u) => !moved.has(u));
    if (firstPass) {
      fallbacks++;
      state = 'fallen_back';
      upSince = null;
    }
    if (!channels.length) return;
    logger.warn(`[Conduit] Outage: moving ${channels.length} channel(s) to IRC`);
    await mapWithConcurrency(channels, FALLBACK_CONCURRENCY, async (username) => {
      try {
        // The gate only flips once IRC is authenticated, so chat never has a gap.
        // Capture the id now: flipping the channel to IRC forgets it.
        const id = deps.broadcasterIdFor?.(username);
        if (!(await deps.startIrc(username))) return;
        if (id) subIds.set(username, id);
        deps.setActiveTransport(username, 'irc');
        moved.add(username);
        recordEventSubFallback();
      } catch (err: any) {
        logger.error(`[Conduit] IRC fallback failed for ${username}: ${err?.message || err}`);
      }
    });
  };

  const recover = async () => {
    // Revocations arrive only over a live shard, so re-read the conduit before trusting the cache.
    try {
      await deps.refreshChatState?.();
    } catch (err: any) {
      logger.warn(`[Conduit] Could not refresh subscriptions before recovery: ${err?.message || err}`);
    }
    const candidates = [...moved];
    const restore: string[] = [];
    for (const username of candidates) {
      // Parted, unlinked or switched during the outage: leave it alone.
      if (deps.getActiveTransport && deps.getActiveTransport(username) !== 'irc') continue;
      if (deps.isChatSubActive && !deps.isChatSubActive(username, subIds.get(username) ?? null)) {
        logger.warn(`[Conduit] ${username} has no enabled chat subscription after the outage; staying on IRC`);
        continue;
      }
      restore.push(username);
    }
    logger.info(`[Conduit] Shard stable again: moving ${restore.length} channel(s) back to eventsub`);
    await mapWithConcurrency(restore, FALLBACK_CONCURRENCY, async (username) => {
      try {
        // Gate first, then drop IRC, so chat never has a gap.
        deps.setActiveTransport(username, 'eventsub');
        await deps.stopIrc(username);
      } catch (err: any) {
        logger.error(`[Conduit] Could not stop IRC for ${username}: ${err?.message || err}`);
      }
    });
    moved.clear();
    subIds.clear();
    state = 'healthy';
    warned = false;
    downSince = null;
    upSince = null;
    await safeWarn('EventSub conduit recovered', `Chat for ${restore.length} channel(s) is back on EventSub.`);
  };

  const step = async () => {
    const assigned = deps.shardsAssigned();
    const t = deps.now();

    if (state === 'fallen_back') {
      if (assigned < 1) {
        upSince = null;
        if (deps.fallbackAfterMs > 0) await fallBack(false);
        return;
      }
      upSince ??= t;
      if (t - upSince >= RECOVER_AFTER_MS) await recover();
      return;
    }

    if (assigned >= 1) {
      state = 'healthy';
      warned = false;
      downSince = null;
      return;
    }

    downSince ??= t;
    const down = t - downSince;
    if (!warned && down >= WARN_AFTER_MS) {
      warned = true;
      state = 'warned';
      await safeWarn(
        'EventSub conduit down',
        `No conduit shard has been connected for ${Math.round(down / 1000)}s.`,
      );
    }
    if (deps.fallbackAfterMs > 0 && down >= deps.fallbackAfterMs) await fallBack(true);
  };

  return {
    async tick(): Promise<void> {
      if (busy) return;
      busy = true;
      try {
        await step();
      } finally {
        busy = false;
      }
    },
    /** Stops tracking a channel whose chat was stopped (part, unlink, switch), so recovery leaves it alone. */
    forgetChannel(username: string): void {
      moved.delete(username);
      subIds.delete(username);
    },
    fallbackCount: () => fallbacks,
    state: () => state,
  };
}

export type ConduitOutageMonitor = ReturnType<typeof createConduitOutageMonitor>;
