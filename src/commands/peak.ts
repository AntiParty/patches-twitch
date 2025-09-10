// peak.ts
import { getCustomResponse, Channel } from '../db';
import fs from 'fs/promises';
import path from 'path';

export const name = 'peak';
export const description = 'Show your peak rank across all seasons (including World Tour)';

// Helper to get all leaderboard files
function getLeaderboardFiles() {
  const regularSeasons = Array.from({ length: 7 }, (_, i) => `regular_s${i + 1}.json`);
  const worldTourSeasons = Array.from({ length: 5 }, (_, i) => `worldTour_s${i + 3}.json`);
  return [...regularSeasons, ...worldTourSeasons];
}

// Normalize a player name for comparison
function normalizeName(name: string) {
  return name?.trim().toLowerCase() || '';
}

// Helper to find a player in a leaderboard
function findPlayer(data: any[] | null, name: string) {
  if (!data) return null;
  const target = normalizeName(name);

  // Exact match first
  let player = data.find(p => normalizeName(p.name) === target);
  if (player) {
    console.log(`[peak] Exact match for '${target}' found:`, player);
  }

  // Fallback for names with #
  if (!player && target.includes('#')) {
    const base = target.split('#')[0];
    // Try startsWith (original logic)
    player = data.find(p => normalizeName(p.name).startsWith(base));
    if (player) {
      console.log(`[peak] startsWith match for base '${base}' found:`, player);
    }
    // If still not found, try includes (for any substring match)
    if (!player) {
      player = data.find(p => normalizeName(p.name).includes(base));
      if (player) {
        console.log(`[peak] includes match for base '${base}' found:`, player);
      }
    }
  }

  if (!player) {
    console.log(`[peak] No match found for '${target}' in this file.`);
  }

  return player;
}

// Get peak rank across all seasons
async function getPeakRankAcrossSeasons(finalsName: string) {
  const files = getLeaderboardFiles();
  let regularPeak: any = null;
  let regularPeakSeason = '';
  let wtPeak: any = null;
  let wtPeakSeason = '';

  for (const file of files) {
    const filePath = path.resolve(__dirname, `../../cache/${file}`);
    try {
      const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
      console.log(`[peak] Checking file: ${file}, searching for: ${finalsName}`);
      const player = findPlayer(data, finalsName);
      if (player) {
        console.log(`[peak] Found player in ${file}:`, player);
      }
      if (file.startsWith('regular')) {
        if (player && (!regularPeak || player.rank < regularPeak.rank)) {
          regularPeak = player;
          regularPeakSeason = file.replace('.json', '');
        }
      } else if (file.startsWith('worldTour')) {
        if (player && (!wtPeak || player.rank < wtPeak.rank)) {
          wtPeak = player;
          wtPeakSeason = file.replace('.json', '');
        }
      }
    } catch (e) {
      console.log(`[peak] Error reading file ${file}:`, e);
      // ignore missing or invalid files
    }
  }

  return {
    regular: regularPeak ? { ...regularPeak, season: regularPeakSeason } : null,
    worldTour: wtPeak ? { ...wtPeak, season: wtPeakSeason } : null,
  };
}

export async function execute(ctx: any, channel: string, message: string, args: string[]) {
  const sanitizedChannel = channel.replace(/^#/, '');

  // Check for custom response first
  const custom = await getCustomResponse(sanitizedChannel, 'peak');
  if (custom) {
    await ctx.say(custom);
    return;
  }

  // Get linked player
  const channelInstance = await Channel.findOne({ where: { username: sanitizedChannel } });
  const playerId = channelInstance?.player_id?.trim();
  if (!playerId) {
    await ctx.say(`No THE FINALS player name linked. Use !link FinalsName#1234`);
    return;
  }

  const peaks = await getPeakRankAcrossSeasons(playerId);

  if (peaks.regular && peaks.worldTour) {
    await ctx.say(
      `Peak rank: #${peaks.regular.rank} ${peaks.regular.league || ''} (${peaks.regular.rankScore?.toLocaleString() || 'N/A'} RS) in ${seasonDisplay(peaks.regular.season)} | WT peak: #${peaks.worldTour.rank} (${seasonDisplay(peaks.worldTour.season)})`
    );
  } else if (peaks.regular) {
    await ctx.say(
      `Peak rank: #${peaks.regular.rank} ${peaks.regular.league || ''} (${peaks.regular.rankScore?.toLocaleString() || 'N/A'} RS) in ${seasonDisplay(peaks.regular.season)}`
    );
  } else if (peaks.worldTour) {
    await ctx.say(
      `WT peak: #${peaks.worldTour.rank} (${seasonDisplay(peaks.worldTour.season)})`
    );
  } else {
    await ctx.say(`No peak rank found for linked account (${playerId}).`);
  }
}

function seasonDisplay(season: string) {
  if (season.startsWith('regular')) {
    return `Season ${season.replace('regular_s', '')}`;
  } else if (season.startsWith('worldTour')) {
    return `World Tour Season ${season.replace('worldTour_s', '')}`;
  }
  return season;
}
