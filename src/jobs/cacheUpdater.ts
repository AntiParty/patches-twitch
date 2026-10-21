// cacheUpdater.ts
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { EventSource } from 'eventsource';
import { sendInfoToDiscord } from '@/handlers/discordHandler';
import logger from '@/util/logger';
import { updateRSHistory } from '@/util/rsPredictor';
import { updatePeakRanks } from '@/jobs/peakUpdater';
import { updateRankProgress } from '@/services/rankGoal.service';
import { recordOperationalEvent } from '@/services/operationalEvents.service';
import { syncConfiguredOwnerWidget } from '@/services/discordOwnerWidget.service';
import { fetchEmbarkRanked, hashPlayers, type LeaderboardPlayer } from '@/services/embarkLeaderboard.service';
import { recordLeaderboardHistory } from '@/services/leaderboardHistory.service';

// ── Sources ──────────────────────────────────────────────────────────────────
// Primary: Embark's official page (see embarkLeaderboard.service). Fallback and
// update-event trigger: davg25's tracker, which can lag a season behind Embark.
const NEW_REGULAR_API_URL  = 'https://www.davg25.com/app/the-finals-leaderboard-tracker/api/vaiiya/leaderboard/';
const NEW_EVENTS_URL       = 'https://www.davg25.com/app/the-finals-leaderboard-tracker/api/vaiiya/events/leaderboard/';
const BANNED_PLAYERS_URL   = 'https://www.davg25.com/app/the-finals-leaderboard-tracker/api/vaiiya/banned-players/';

// Embark's page is regenerated roughly every 15 minutes.
const POLL_INTERVAL = 15 * 60 * 1000;

function getCachePath(type: 'regular', season: number) {
  const filename = `regular_s${season}.json`;
  return path.resolve(__dirname, `../../cache/${filename}`);
}

const META_FILE = path.resolve(__dirname, '../../cache/meta.json');

interface CacheMeta {
  season: number;
  seasonId: string;
  updatedAt: string | null;      // last time the board actually changed
  transitioning: boolean;
  lastCheckedAt?: string | null; // last fetch attempt, changed or not
  nextCheckAt?: string | null;   // next scheduled poll
}

let meta: CacheMeta | null = null;

async function saveMeta(next: CacheMeta) {
  meta = next;
  try {
    await fs.writeFile(META_FILE, JSON.stringify(next, null, 2), 'utf8');
  } catch (e) {
    logger.error('[CacheUpdater] Failed to write meta.json:', e);
  }
}

async function writeMeta(season: number, seasonId: string, updatedAt: string | null, transitioning: boolean) {
  await saveMeta({ ...meta, season, seasonId, updatedAt, transitioning });
}

// Set when the poll timer starts or ticks; read by the page's "next check" countdown.
let nextPollAt: number | null = null;

async function recordCheck() {
  if (!meta) return; // nothing known about the season yet
  await saveMeta({
    ...meta,
    lastCheckedAt: new Date().toISOString(),
    nextCheckAt: nextPollAt ? new Date(nextPollAt).toISOString() : null,
  });
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Field normalizer ─────────────────────────────────────────────────────────
// Maps davg25 field names → cache field names so all consumers work unchanged.
function normalizePlayer(p: any): LeaderboardPlayer {
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

// ── Season + change-detection state ──────────────────────────────────────────
let storedETag = '';               // davg25 ETag, gates the fallback GET
let lastBoardHash = '';            // skips rewrites when the board hasn't changed
let currentRegularSeason = 9;      // seeded from meta.json, advanced by Embark's leaderboard list
let seasonLoaded = false;

async function loadSeasonFromMeta() {
  if (seasonLoaded) return;
  seasonLoaded = true;
  try {
    const saved = JSON.parse(await fs.readFile(META_FILE, 'utf8'));
    if (Number.isInteger(saved?.season) && saved.season > 0) {
      currentRegularSeason = saved.season;
      meta = saved;
    }
  } catch {
    // meta.json missing — keep the default
  }
}

interface FetchedBoard {
  season: number;
  players: LeaderboardPlayer[];
  source: 'embark' | 'davg25';
}

// Returns null when the davg25 ETag says nothing changed.
async function fetchFromDavg(forceWrite: boolean): Promise<FetchedBoard | null> {
  if (!forceWrite && storedETag) {
    try {
      const head = await axios.head(NEW_REGULAR_API_URL, { timeout: 5000 });
      const newETag = head.headers['etag'];
      if (newETag && newETag === storedETag) {
        logger.info('[CacheUpdater] davg25 leaderboard unchanged (ETag match), skipping.');
        return null;
      }
    } catch {
      // HEAD failed — fall through to full GET
    }
  }

  const response = await axios.get(NEW_REGULAR_API_URL, { timeout: 15000 });
  if (response.status !== 200) {
    throw new Error(`davg25 API returned status ${response.status}`);
  }

  let season = currentRegularSeason;
  const seasonHeader = response.headers['x-seasonid'] as string | undefined;
  if (seasonHeader) {
    const parsed = parseInt(seasonHeader.replace('s', ''), 10);
    if (!isNaN(parsed)) season = parsed;
  }

  const newETag = response.headers['etag'];
  if (newETag) storedETag = newETag;

  const raw = response.data;
  return {
    season,
    players: Array.isArray(raw) ? raw.map(normalizePlayer) : [],
    source: 'davg25',
  };
}

async function fetchBoard(forceWrite: boolean): Promise<FetchedBoard | null> {
  try {
    const result = await fetchEmbarkRanked(currentRegularSeason);
    return { season: result.season, players: result.players, source: 'embark' };
  } catch (embarkError) {
    logger.warn('[CacheUpdater] Embark fetch failed — falling back to davg25:', embarkError);
    return fetchFromDavg(forceWrite);
  }
}

// ── Fetch regular leaderboard + write cache ──────────────────────────────────
export async function fetchAndWriteRegular(forceWrite = false): Promise<boolean> {
  try {
    return await refreshRegular(forceWrite);
  } finally {
    await recordCheck();
  }
}

async function refreshRegular(forceWrite: boolean): Promise<boolean> {
  const startedAt = Date.now();
  try {
    await loadSeasonFromMeta();

    const board = await fetchBoard(forceWrite);
    if (!board) return false;

    // davg25 can still report the previous season after Embark has moved on.
    if (board.season < currentRegularSeason) {
      logger.warn(`[CacheUpdater] ${board.source} returned S${board.season} but S${currentRegularSeason} is current, skipping.`);
      return false;
    }

    if (board.season > currentRegularSeason) {
      logger.info(`[CacheUpdater] New season detected via ${board.source}: S${currentRegularSeason} → S${board.season}.`);
      sendInfoToDiscord(`[Cache] New season detected: S${board.season} (was S${currentRegularSeason}).`);
      void recordOperationalEvent({
        type: 'season_change_detected',
        severity: 'info',
        reasonCode: `s${currentRegularSeason}_to_s${board.season}`,
        outcome: 'success',
      });
      currentRegularSeason = board.season;
      lastBoardHash = '';
    }

    const seasonId = `s${currentRegularSeason}`;

    if (board.players.length === 0) {
      // New season just started — leaderboard not populated yet
      await writeMeta(currentRegularSeason, seasonId, null, true);
      throw new Error(`${board.source} returned an empty S${currentRegularSeason} leaderboard`);
    }

    const normalized = board.players;
    const hash = hashPlayers(normalized);
    if (hash === lastBoardHash) {
      logger.info(`[CacheUpdater] S${currentRegularSeason} leaderboard unchanged (${board.source}), skipping.`);
      return false;
    }
    lastBoardHash = hash;

    const cachePath = getCachePath('regular', currentRegularSeason);
    await fs.writeFile(cachePath, JSON.stringify(normalized, null, 2), 'utf8');
    logger.info(`[CacheUpdater] Regular S${currentRegularSeason} cache updated from ${board.source} — ${normalized.length} entries.`);

    // Write meta.json so other modules know the current season
    await writeMeta(currentRegularSeason, seasonId, new Date().toISOString(), false);

    // Post-update hooks
    try {
      const recorded = await recordLeaderboardHistory(currentRegularSeason, normalized);
      logger.info(`[CacheUpdater] Leaderboard history: ${recorded} changed players recorded.`);
    } catch (e) { logger.error('[CacheUpdater] recordLeaderboardHistory error:', e); }
    try { await updateRSHistory();  } catch (e) { logger.error('[CacheUpdater] updateRSHistory error:', e); }
    try { await updatePeakRanks();  } catch (e) { logger.error('[CacheUpdater] updatePeakRanks error:', e); }
    try { await updateRankProgress(normalized, currentRegularSeason); } catch (e) { logger.error('[CacheUpdater] updateRankProgress error:', e); }
    void syncConfiguredOwnerWidget(normalized)
      .then((result) => {
        if (result.ok) {
          logger.info('[CacheUpdater] Discord owner widget synced.');
        } else if (result.reason !== 'not_configured' && result.reason !== 'already_syncing') {
          logger.warn(`[CacheUpdater] Discord owner widget skipped: ${result.reason}.`);
        }
      })
      .catch((error) => {
        logger.error('[CacheUpdater] Discord owner widget sync error:', error);
      });

    void recordOperationalEvent({
      type: 'cache_refresh_succeeded',
      severity: 'info',
      durationMs: Date.now() - startedAt,
      outcome: 'success',
    });
    return true;
  } catch (error) {
    logger.error('[CacheUpdater] Failed to fetch regular leaderboard:', error);
    void recordOperationalEvent({
      type: 'cache_refresh_failed',
      severity: 'warning',
      durationMs: Date.now() - startedAt,
      reasonCode: 'leaderboard_fetch_failed',
      outcome: 'failure',
    });
    return false;
  }
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

// ── Banned players cache ──────────────────────────────────────────────────────
const BANNED_CACHE_FILE = path.resolve(__dirname, '../../cache/banned_players.json');

export async function fetchAndWriteBannedPlayers(): Promise<void> {
  try {
    const response = await axios.get(BANNED_PLAYERS_URL, { timeout: 15000 });
    if (!Array.isArray(response.data)) {
      logger.warn('[CacheUpdater] Banned players API returned non-array response.');
      return;
    }
    // Sort newest first, keep active bans only (unbanTimestamp === null)
    const active = (response.data as any[])
      .filter(p => p.unbanTimestamp === null)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    await fs.writeFile(BANNED_CACHE_FILE, JSON.stringify(active, null, 2), 'utf8');
    logger.info(`[CacheUpdater] Banned players cache updated — ${active.length} active bans.`);
  } catch (err) {
    logger.error('[CacheUpdater] Failed to fetch banned players:', err);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
let lastUpdate = Date.now();

export function startCacheUpdater() {
  nextPollAt = Date.now() + POLL_INTERVAL;

  // 1. Immediate first fetch (regular leaderboard + banned players)
  Promise.all([
    fetchAndWriteRegular(true),
    fetchAndWriteBannedPlayers(),
  ])
    .then(() => {
      lastUpdate = Date.now();
      sendInfoToDiscord(`[Cache] Initial cache load complete (S${currentRegularSeason}).`);
    })
    .catch(logger.error);

  // 2. davg25 update events — a cue to re-check the board
  startEventSource();

  // 3. Embark poll (hash-gated, won't re-write if unchanged)
  setInterval(async () => {
    nextPollAt = Date.now() + POLL_INTERVAL;
    const updated = await fetchAndWriteRegular();
    if (updated) {
      lastUpdate = Date.now();
      sendInfoToDiscord(`[Cache] Poll updated regular leaderboard (S${currentRegularSeason}).`);
    }
  }, POLL_INTERVAL);

  // 4. Banned players poll — every 10 minutes
  const BANNED_INTERVAL = 10 * 60 * 1000;
  setInterval(fetchAndWriteBannedPlayers, BANNED_INTERVAL);
}

export function getNextCacheUpdateInfo(intervalMs = POLL_INTERVAL) {
  const now = Date.now();
  const nextUpdateAt = nextPollAt ?? Math.max(0, lastUpdate + intervalMs);
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
    await loadSeasonFromMeta();
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
  ]);
  lastUpdate = Date.now();
}
