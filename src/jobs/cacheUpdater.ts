// cacheUpdater.ts
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';


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
}

export function startCacheUpdater(intervalMs = 45 * 60 * 1000) {
  updateAllCaches();
  setInterval(updateAllCaches, intervalMs);
}