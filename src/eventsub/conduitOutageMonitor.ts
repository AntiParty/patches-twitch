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

  const safeWarn = async (title: string, body: string) => {
    try {
      await deps.warn(title, body);
    } catch (err: any) {
      logger.error(`[Conduit] Could not send "${title}" warning: ${err?.message || err}`);
    }
  };

  const fallBack = async () => {
    const channels = deps.eventsubChannels();
    fallbacks++;
    state = 'fallen_back';
    upSince = null;
    logger.warn(`[Conduit] Outage: moving ${channels.length} channel(s) to IRC`);
    await mapWithConcurrency(channels, FALLBACK_CONCURRENCY, async (username) => {
      try {
        // The gate only flips once IRC is authenticated, so chat never has a gap.
        if (!(await deps.startIrc(username))) return;
        deps.setActiveTransport(username, 'irc');
        moved.add(username);
        recordEventSubFallback();
      } catch (err: any) {
        logger.error(`[Conduit] IRC fallback failed for ${username}: ${err?.message || err}`);
      }
    });
  };

  const recover = async () => {
    const channels = [...moved];
    logger.info(`[Conduit] Shard stable again: moving ${channels.length} channel(s) back to eventsub`);
    await mapWithConcurrency(channels, FALLBACK_CONCURRENCY, async (username) => {
      try {
        // Gate first, then drop IRC, so chat never has a gap.
        deps.setActiveTransport(username, 'eventsub');
        await deps.stopIrc(username);
      } catch (err: any) {
        logger.error(`[Conduit] Could not stop IRC for ${username}: ${err?.message || err}`);
      }
    });
    moved.clear();
    state = 'healthy';
    warned = false;
    downSince = null;
    upSince = null;
    await safeWarn('EventSub conduit recovered', `Chat for ${channels.length} channel(s) is back on EventSub.`);
  };

  const step = async () => {
    const assigned = deps.shardsAssigned();
    const t = deps.now();

    if (state === 'fallen_back') {
      if (assigned < 1) {
        upSince = null;
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
    if (deps.fallbackAfterMs > 0 && down >= deps.fallbackAfterMs) await fallBack();
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
    fallbackCount: () => fallbacks,
    state: () => state,
  };
}

export type ConduitOutageMonitor = ReturnType<typeof createConduitOutageMonitor>;
