// cacheUpdater.ts
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { sendInfoToDiscord } from '@/handlers/discordHandler';
import logger from '@/util/logger';
import exp from 'constants';
import { updateRSHistory } from '@/util/rsPredictor';
import { updatePeakRanks } from '@/jobs/peakUpdater';

let lastUpdate = Date.now();
const updateIntervalMs = 35 * 60 * 1000; // 35 minutes 

const REGULAR_SEASON_START = 1;
const WORLD_TOUR_SEASON_START = 3;
// Update this if new seasons are added
const REGULAR_SEASON_END = 9;
const WORLD_TOUR_SEASON_END = 9;

function getApiUrl(type: 'regular' | 'worldTour', season: number) {
  if (type === 'regular') {
    return `https://api.the-finals-leaderboard.com/v1/leaderboard/s${season}/crossplay`;
  } else {
    return `https://api.the-finals-leaderboard.com/v1/leaderboard/s${season}worldtour/crossplay`;
  }
}

function getCachePath(type: 'regular' | 'worldTour', season: number) {
  if (type === 'regular') {
    return path.resolve(__dirname, `../../cache/regular_s${season}.json`);
  } else {
    return path.resolve(__dirname, `../../cache/worldTour_s${season}.json`);
  }
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function updateAllCachesRateLimited() {
  const regularSeasons = Array.from({ length: REGULAR_SEASON_END - REGULAR_SEASON_START + 1 }, (_, i) => REGULAR_SEASON_START + i);
  const worldTourSeasons = Array.from({ length: WORLD_TOUR_SEASON_END - WORLD_TOUR_SEASON_START + 1 }, (_, i) => WORLD_TOUR_SEASON_START + i);

  const delayBetweenRequests = 500; // ms delay between each request (customizable)

  for (const season of regularSeasons) {
    await updateCache('regular', season);
    await delay(delayBetweenRequests);
  }

  for (const season of worldTourSeasons) {
    await updateCache('worldTour', season);
    await delay(delayBetweenRequests);
  }

  try {
    await updateRSHistory();
  } catch (e) {
    logger.error("Error updating RS history:", e);
  }

  try {
    await updatePeakRanks();
  } catch (e) {
    logger.error("Error updating peak ranks:", e);
  }

  lastUpdate = Date.now(); // Update lastUpdate after all caches are updated
  sendInfoToDiscord(`Cache update completed at ${new Date().toLocaleString()}`);
}

async function updateCache(type: 'regular' | 'worldTour', season: number) {
  const url = getApiUrl(type, season);
  const cachePath = getCachePath(type, season);

  try {
    logger.info(`Fetching ${type} leaderboard data for season ${season}...`);
    const response = await axios.get(url);
    if (response.status !== 200) {
      throw new Error(`${type} API (season ${season}) returned status ${response.status}`);
    }

    const leaderboardData = response.data.data;
    if (!Array.isArray(leaderboardData)) {
      throw new Error(`Invalid ${type} leaderboard data format for season ${season}`);
    }

    await fs.writeFile(cachePath, JSON.stringify(leaderboardData, null, 2), 'utf8');
    logger.info(`${type} cache for season ${season} updated with ${leaderboardData.length} entries.`);
  } catch (error) {
    logger.error(`Error updating ${type} cache for season ${season}:`, error);
    try {
      const cachedData = await fs.readFile(cachePath, 'utf8');
      logger.info(`Loaded fallback ${type} cache for season ${season} with ${JSON.parse(cachedData).length} entries.`);
    } catch {
      logger.error(`No valid fallback ${type} cache found for season ${season}.`);
    }
  }
}

export async function updateAllCaches() {
  const regularSeasons = Array.from({ length: REGULAR_SEASON_END - REGULAR_SEASON_START + 1 }, (_, i) => REGULAR_SEASON_START + i);
  const worldTourSeasons = Array.from({ length: WORLD_TOUR_SEASON_END - WORLD_TOUR_SEASON_START + 1 }, (_, i) => WORLD_TOUR_SEASON_START + i);

  const updatePromises = [
    ...regularSeasons.map(season => updateCache('regular', season)),
    ...worldTourSeasons.map(season => updateCache('worldTour', season)),
  ];
  await Promise.all(updatePromises);
  lastUpdate = Date.now(); // Update lastUpdate after all caches are updated
}

export function startCacheUpdater(intervalMs = 45 * 60 * 1000) {
  // Run immediately first
  updateAllCachesRateLimited().catch(logger.error);

  // Then run every interval
  setInterval(() => {
    updateAllCachesRateLimited().catch(logger.error);
  }, intervalMs);
}

export function getNextCacheUpdateInfo(intervalMs = 45 * 60 * 1000) {
  const now = Date.now();
  const nextUpdateAt = Math.max(0, lastUpdate + intervalMs);
  const msLeft = Math.max(0, nextUpdateAt - now);
  return { nextUpdateAt, msLeft };
}

function getRegularCachePath(season: number) {
  return path.resolve(__dirname, `../../cache/regular_s${season}.json`);
}

async function loadRegularSeasonData(season: number) {
  const cachePath = getRegularCachePath(season);
  const raw = await fs.readFile(cachePath, "utf8");
  return JSON.parse(raw);
}
export async function getRubyRankThreshold() {
  try {
    const data = await loadRegularSeasonData(REGULAR_SEASON_END);

    if (!data || data.length < 500) {
      logger.error(`Season ${REGULAR_SEASON_END} does not have 500 players.`);
      return undefined;
    }

    // Leaderboard is already sorted, so index 499 = rank 500
    const entry = data[499];
    
    return {
      season: REGULAR_SEASON_END,
      league: entry.league,
      threshold: entry.rankScore,
      player: entry.name,
    };
  } catch (err) {
    logger.error("Failed to get Ruby threshold:", err);
    return undefined;
  }
}