// cacheUpdater.ts
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { EventSource } from 'eventsource';
import { sendInfoToDiscord } from '@/handlers/discordHandler';
import logger from '@/util/logger';
import { updateRSHistory } from '@/util/rsPredictor';
import { updatePeakRanks } from '@/jobs/peakUpdater';

// ── New API ──────────────────────────────────────────────────────────────────
const NEW_REGULAR_API_URL = 'https://www.davg25.com/app/the-finals-leaderboard-tracker/api/vaiiya/leaderboard/';
const NEW_EVENTS_URL      = 'https://www.davg25.com/app/the-finals-leaderboard-tracker/api/vaiiya/events/leaderboard/';

// ── Old API (World Tour only — not available on new API yet) ─────────────────
// Only the current season is fetched on each update; old seasons are already
// on disk from the initial migration and don't change.
const WORLD_TOUR_CURRENT_SEASON = 9;

function getWorldTourApiUrl(season: number) {
  return `https://api.the-finals-leaderboard.com/v1/leaderboard/s${season}worldtour/crossplay`;
}

function getCachePath(type: 'regular' | 'worldTour', season: number) {
  const filename = type === 'regular'
    ? `regular_s${season}.json`
    : `worldTour_s${season}.json`;
  return path.resolve(__dirname, `../../cache/${filename}`);
}

const META_FILE = path.resolve(__dirname, '../../cache/meta.json');

async function writeMeta(season: number, seasonId: string, updatedAt: string | null, transitioning: boolean) {
  try {
    await fs.writeFile(META_FILE, JSON.stringify({ season, seasonId, updatedAt, transitioning }, null, 2), 'utf8');
  } catch (e) {
    logger.error('[CacheUpdater] Failed to write meta.json:', e);
  }
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Field normalizer ─────────────────────────────────────────────────────────
// Maps new API field names → old cache field names so all consumers work unchanged.
function normalizePlayer(p: any) {
  return {
    rank:         p.rank,
    change:       p.rankChange ?? 0,
    name:         p.id,            // id  → name
    steamName:    p.steamId  ?? '',
    psnName:      p.psnId   ?? '',
    xboxName:     p.xboxId  ?? '',
    clubTag:      p.clubTag  ?? '',
    leagueNumber: p.league,        // league (number) → leagueNumber
    league:       p.leagueName,    // leagueName (string) → league
    rankScore:    p.points,        // points → rankScore
  };
}

// ── ETag state (for 2-hour fallback poll) ────────────────────────────────────
let storedETag = '';
let currentRegularSeason = 9; // updated from x-seasonid header on each fetch

// ── Fetch regular leaderboard + write cache ──────────────────────────────────
export async function fetchAndWriteRegular(forceWrite = false): Promise<boolean> {
  try {
    // ETag check — skip full GET if leaderboard hasn't changed
    if (!forceWrite && storedETag) {
      try {
        const head = await axios.head(NEW_REGULAR_API_URL, { timeout: 5000 });
        const newETag = head.headers['etag'];
        if (newETag && newETag === storedETag) {
          logger.info('[CacheUpdater] Regular leaderboard unchanged (ETag match), skipping.');
          return false;
        }
      } catch {
        // HEAD failed — fall through to full GET
      }
    }

    const response = await axios.get(NEW_REGULAR_API_URL, { timeout: 15000 });

    if (response.status !== 200) {
      throw new Error(`New API returned status ${response.status}`);
    }

    const raw: any[] = response.data;

    // Read season from header before checking data length
    const seasonHeader = response.headers['x-seasonid'] as string | undefined;
    if (seasonHeader) {
      const parsed = parseInt(seasonHeader.replace('s', ''), 10);
      if (!isNaN(parsed)) currentRegularSeason = parsed;
    }

    if (!Array.isArray(raw) || raw.length === 0) {
      // New season just started — leaderboard not populated yet
      await writeMeta(currentRegularSeason, seasonHeader ?? `s${currentRegularSeason}`, null, true);
      throw new Error('New API returned empty or non-array response');
    }

    // Store new ETag
    const newETag = response.headers['etag'];
    if (newETag) storedETag = newETag;

    // Normalize and write
    const normalized = raw.map(normalizePlayer);
    const cachePath = getCachePath('regular', currentRegularSeason);
    await fs.writeFile(cachePath, JSON.stringify(normalized, null, 2), 'utf8');
    logger.info(`[CacheUpdater] Regular S${currentRegularSeason} cache updated — ${normalized.length} entries.`);

    // Write meta.json so other modules know the current season
    await writeMeta(currentRegularSeason, seasonHeader ?? `s${currentRegularSeason}`, new Date().toISOString(), false);

    // Post-update hooks
    try { await updateRSHistory();  } catch (e) { logger.error('[CacheUpdater] updateRSHistory error:', e); }
    try { await updatePeakRanks();  } catch (e) { logger.error('[CacheUpdater] updatePeakRanks error:', e); }

    return true;
  } catch (error) {
    logger.error('[CacheUpdater] Failed to fetch regular leaderboard:', error);
    return false;
  }
}

// ── World Tour (old API, unchanged) ──────────────────────────────────────────
async function updateWorldTourCache(season: number) {
  const url       = getWorldTourApiUrl(season);
  const cachePath = getCachePath('worldTour', season);

  try {
    const response = await axios.get(url, { timeout: 15000 });
    if (response.status !== 200) throw new Error(`WT API (S${season}) status ${response.status}`);

    const data = response.data.data;
    if (!Array.isArray(data)) throw new Error(`Invalid WT data for S${season}`);

    await fs.writeFile(cachePath, JSON.stringify(data, null, 2), 'utf8');
    logger.info(`[CacheUpdater] World Tour S${season} cache updated — ${data.length} entries.`);
  } catch (error) {
    logger.error(`[CacheUpdater] Failed to update World Tour S${season}:`, error);
    try {
      const cached = await fs.readFile(cachePath, 'utf8');
      logger.info(`[CacheUpdater] Using fallback WT S${season} cache (${JSON.parse(cached).length} entries).`);
    } catch {
      logger.error(`[CacheUpdater] No fallback WT S${season} cache available.`);
    }
  }
}

async function updateAllWorldTourCaches() {
  await updateWorldTourCache(WORLD_TOUR_CURRENT_SEASON);
}

// ── EventSource — real-time leaderboard updates ──────────────────────────────
let es: InstanceType<typeof EventSource> | null = null;
let esRetryDelay = 500;
const ES_MAX_RETRY = 60_000;

function startEventSource() {
  if (es) { es.close(); es = null; }

  logger.info('[CacheUpdater] Connecting to leaderboard event stream…');
  es = new EventSource(NEW_EVENTS_URL);

  es.addEventListener('update', async () => {
    logger.info('[CacheUpdater] Leaderboard update event received — fetching…');
    const updated = await fetchAndWriteRegular(true); // force write on SSE event
    if (updated) {
      esRetryDelay = 500; // reset backoff on successful update
      sendInfoToDiscord(`[Cache] Regular leaderboard updated via event stream (S${currentRegularSeason}).`);
    }
  });

  es.onerror = () => {
    logger.warn(`[CacheUpdater] Event stream error — reconnecting in ${esRetryDelay}ms…`);
    es?.close();
    es = null;
    setTimeout(() => {
      esRetryDelay = Math.min(esRetryDelay * 2, ES_MAX_RETRY);
      startEventSource();
    }, esRetryDelay);
  };

  es.onopen = () => {
    logger.info('[CacheUpdater] Event stream connected.');
    esRetryDelay = 500;
  };
}

// ── Public API ────────────────────────────────────────────────────────────────
let lastUpdate = Date.now();

export function startCacheUpdater() {
  // 1. Immediate first fetch (regular + world tour)
  Promise.all([
    fetchAndWriteRegular(true),
    updateAllWorldTourCaches(),
  ])
    .then(() => {
      lastUpdate = Date.now();
      sendInfoToDiscord(`[Cache] Initial cache load complete (S${currentRegularSeason}).`);
    })
    .catch(logger.error);

  // 2. Real-time updates via EventSource
  startEventSource();

  // 3. 2-hour fallback poll (ETag-gated, won't re-write if unchanged)
  const FALLBACK_INTERVAL = 2 * 60 * 60 * 1000;
  setInterval(async () => {
    const updated = await fetchAndWriteRegular();
    await updateAllWorldTourCaches();
    if (updated) {
      lastUpdate = Date.now();
      sendInfoToDiscord(`[Cache] Fallback poll updated regular leaderboard (S${currentRegularSeason}).`);
    }
  }, FALLBACK_INTERVAL);
}

export function getNextCacheUpdateInfo(intervalMs = 2 * 60 * 60 * 1000) {
  const now = Date.now();
  const nextUpdateAt = Math.max(0, lastUpdate + intervalMs);
  const msLeft = Math.max(0, nextUpdateAt - now);
  return { nextUpdateAt, msLeft };
}

// ── Helpers used by other modules ─────────────────────────────────────────────
function getRegularCachePath(season: number) {
  return path.resolve(__dirname, `../../cache/regular_s${season}.json`);
}

async function loadRegularSeasonData(season: number) {
  const cachePath = getRegularCachePath(season);
  const raw = await fs.readFile(cachePath, 'utf8');
  return JSON.parse(raw);
}

export async function getRubyRankThreshold() {
  try {
    const data = await loadRegularSeasonData(currentRegularSeason);

    if (!data || data.length < 500) {
      logger.error(`[CacheUpdater] S${currentRegularSeason} has fewer than 500 players.`);
      return undefined;
    }

    const entry = data[499]; // sorted by rank, index 499 = rank 500
    return {
      season:    currentRegularSeason,
      league:    entry.league,
      threshold: entry.rankScore,
      player:    entry.name,
    };
  } catch (err) {
    logger.error('[CacheUpdater] Failed to get Ruby threshold:', err);
    return undefined;
  }
}

// Legacy export kept for any callers that use updateAllCaches() directly
export async function updateAllCaches() {
  await Promise.all([
    fetchAndWriteRegular(true),
    updateAllWorldTourCaches(),
  ]);
  lastUpdate = Date.now();
}
