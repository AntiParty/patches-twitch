// cacheUpdater.ts
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';

const CACHE_PATHS = {
  regular: path.resolve(__dirname, 'leaderboardCache.json'),
  worldTour: path.resolve(__dirname, 'WTrankCache.json'),
};

const API_URLS = {
  regular: 'https://api.the-finals-leaderboard.com/v1/leaderboard/s7/crossplay',
  worldTour: 'https://api.the-finals-leaderboard.com/v1/leaderboard/s7worldtour/crossplay',
};

async function updateCache(name: 'regular' | 'worldTour') {
  const url = API_URLS[name];
  const cachePath = CACHE_PATHS[name];

  try {
    console.log(`Fetching ${name} leaderboard data...`);
    const response = await axios.get(url);
    if (response.status !== 200) {
      throw new Error(`${name} API returned status ${response.status}`);
    }

    const leaderboardData = response.data.data;
    if (!Array.isArray(leaderboardData)) {
      throw new Error(`Invalid ${name} leaderboard data format`);
    }

    await fs.writeFile(cachePath, JSON.stringify(leaderboardData, null, 2), 'utf8');
    console.log(`${name} cache updated with ${leaderboardData.length} entries.`);
  } catch (error) {
    console.error(`Error updating ${name} cache:`, error);
  }
}

export async function updateAllCaches() {
  await Promise.all([updateCache('regular'), updateCache('worldTour')]);
}

export function startCacheUpdater(intervalMs = 45 * 60 * 1000) {
  updateAllCaches();
  setInterval(updateAllCaches, intervalMs);
}
