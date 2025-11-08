// cacheUpdater.ts
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { sendMessageToDiscord } from '@/handlers/discordHandler';

let lastUpdate = Date.now();
const updateIntervalMs = 45 * 60 * 1000; // 45 minutes

const REGULAR_SEASON_START = 1;
const WORLD_TOUR_SEASON_START = 3;
// Update this if new seasons are added
const REGULAR_SEASON_END = 8;
const WORLD_TOUR_SEASON_END = 8;

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

  lastUpdate = Date.now(); // Update lastUpdate after all caches are updated
  sendMessageToDiscord(`Cache update completed at ${new Date().toLocaleString()}`);
}

async function updateCache(type: 'regular' | 'worldTour', season: number) {
  const url = getApiUrl(type, season);
  const cachePath = getCachePath(type, season);

  try {
    console.log(`Fetching ${type} leaderboard data for season ${season}...`);
    const response = await axios.get(url);
    if (response.status !== 200) {
      throw new Error(`${type} API (season ${season}) returned status ${response.status}`);
    }

    const leaderboardData = response.data.data;
    if (!Array.isArray(leaderboardData)) {
      throw new Error(`Invalid ${type} leaderboard data format for season ${season}`);
    }

    await fs.writeFile(cachePath, JSON.stringify(leaderboardData, null, 2), 'utf8');
    console.log(`${type} cache for season ${season} updated with ${leaderboardData.length} entries.`);
  } catch (error) {
    console.error(`Error updating ${type} cache for season ${season}:`, error);
    try {
      const cachedData = await fs.readFile(cachePath, 'utf8');
      console.log(`Loaded fallback ${type} cache for season ${season} with ${JSON.parse(cachedData).length} entries.`);
    } catch {
      console.error(`No valid fallback ${type} cache found for season ${season}.`);
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
  updateAllCachesRateLimited().catch(console.error);

  // Then run every interval
  setInterval(() => {
    updateAllCachesRateLimited().catch(console.error);
  }, intervalMs);
}

export function getNextCacheUpdateInfo(intervalMs = 45 * 60 * 1000) {
  const now = Date.now();
  const nextUpdateAt = Math.max(0, lastUpdate + intervalMs);
  const msLeft = Math.max(0, nextUpdateAt - now);
  return { nextUpdateAt, msLeft };
}