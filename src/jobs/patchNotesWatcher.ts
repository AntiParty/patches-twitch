// patchNotesWatcher.ts
// Watches Steam for Embark's weekly patch notes (Thursdays ~10:00 UTC) and keeps
// the weapon stats in sync with thefinals.wiki. Everything it finds lands in the
// admin review queue (/admin/balance); nothing is applied automatically.
import logger from '@/util/logger';
import { getMeta, pollPatchNotesNow, syncWikiNow } from '@/services/balanceReview.service';

const TICK_MS = 15 * 60 * 1000;
const OFF_WINDOW_POLL_MS = 6 * 60 * 60 * 1000;
const WIKI_SYNC_MS = 6 * 60 * 60 * 1000;
const WIKI_AFTER_PATCH_MS = 3 * 60 * 60 * 1000;
const DEFAULT_TZ = 'America/Chicago';

function resolveTimeZone(tz?: string): string {
  const candidate = tz || process.env.PATCH_NOTES_TZ || DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch {
    logger.warn(`[patchNotes] Unknown PATCH_NOTES_TZ "${candidate}", using ${DEFAULT_TZ}`);
    return DEFAULT_TZ;
  }
}

/** Local weekday (0 = Sunday) and hour (0-23) in `tz`. */
export function localDayAndHour(now: Date, tz: string): { weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  const weekdayName = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekdayName);
  return { weekday, hour: hour % 24 };
}

/** Thursday 04:00-08:59 local: poll every tick. Otherwise at most every 6 hours. */
export function shouldPollNow(now: Date, lastPollAt: number | null, tz: string = DEFAULT_TZ): boolean {
  const { weekday, hour } = localDayAndHour(now, tz);
  if (weekday === 4 && hour >= 4 && hour < 9) return true;
  return lastPollAt == null || now.getTime() - lastPollAt > OFF_WINDOW_POLL_MS;
}

export function startPatchNotesWatcher(): () => void {
  const tz = resolveTimeZone();
  let stopped = false;
  let busy = false;
  let lastPollAt: number | null = null;
  let lastWikiAt: number | null = null;
  let extraWikiAt: number | null = null;

  const runWiki = async () => {
    try {
      const summary = await syncWikiNow();
      lastWikiAt = Date.now();
      extraWikiAt = null;
      return summary;
    } catch (err) {
      // Retry on the next tick rather than waiting six hours.
      logger.error('[patchNotes] Wiki sync failed:', err);
    }
  };

  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const now = new Date();
      if (shouldPollNow(now, lastPollAt, tz)) {
        try {
          const results = await pollPatchNotesNow();
          lastPollAt = Date.now();
          if (results.some((r) => r.status === 'pending' || r.status === 'reviewed')) extraWikiAt = Date.now() + WIKI_AFTER_PATCH_MS;
        } catch (err) {
          logger.error('[patchNotes] Steam poll failed:', err);
        }
      }
      const wikiDue = lastWikiAt == null || Date.now() - lastWikiAt >= WIKI_SYNC_MS || (extraWikiAt != null && Date.now() >= extraWikiAt);
      if (wikiDue) await runWiki();
    } finally {
      busy = false;
    }
  };

  void (async () => {
    // Resume the poll clock across restarts so a bounce doesn't trigger a poll each time.
    const saved = await getMeta('steam_last_poll').catch(() => null);
    if (saved && Number.isFinite(Date.parse(saved))) lastPollAt = Date.parse(saved);
    await tick();
  })();
  const handle = setInterval(() => void tick(), TICK_MS);
  logger.info(`[patchNotes] Watcher started (tz ${tz})`);

  return () => {
    stopped = true;
    clearInterval(handle);
  };
}
