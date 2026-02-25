// peak.ts
import { getCustomResponse, Channel } from '../db';
import fs from 'fs/promises';
import path from 'path';
import logger from '../util/logger';

export const name = 'peak';
export const description = 'Show your peak rank across all seasons (including Cashout)';

// Helper to get all leaderboard files
async function getLeaderboardFiles() {
  const cacheDir = path.resolve(__dirname, '../../cache');
  try {
    const files = await fs.readdir(cacheDir);
    // keep files that match regular_sN.json or worldTour_sN.json
    return files
      .filter(f => /^(regular_s\d+|worldTour_s\d+)\.json$/.test(f))
      // sort by name so order is deterministic (optional)
      .sort((a, b) => a.localeCompare(b));
  } catch (e) {
    logger.info('[peak] Error reading cache directory', e);
    return [];
  }
}

// Normalize a player name for comparison
function normalizeName(name: string) {
  return name?.toLowerCase().trim() || '';
}

// Helper to find a player in a leaderboard
function findPlayer(data: any[] | null, name: string) {
  if (!data) return null;
  const target = normalizeName(name);

  const fieldsToCheck = ["name", "steamName", "psnName", "xboxName"];

  const normalize = (v: any) => v ? v.toLowerCase().trim() : "";

  // 1. Exact match in ANY field
  for (const player of data) {
    for (const f of fieldsToCheck) {
      if (normalize(player[f]) === target) {
        logger.info(`[peak] Exact match for '${target}' on field '${f}' found:`, player);
        return player;
      }
    }
  }

  // 2. If target includes #, fallback to nickname match
  if (target.includes("#")) {
    const base = normalize(target.split("#")[0]);

    // startsWith
    for (const player of data) {
      for (const f of fieldsToCheck) {
        if (normalize(player[f]).startsWith(base)) {
          logger.info(`[peak] startsWith match for base '${base}' found in field '${f}':`, player);
          return player;
        }
      }
    }

    // includes
    for (const player of data) {
      for (const f of fieldsToCheck) {
        if (normalize(player[f]).includes(base)) {
          logger.info(`[peak] includes match for base '${base}' found in field '${f}':`, player);
          return player;
        }
      }
    }
  }

  logger.info(`[peak] No match found for '${target}'`);
  return null;
}

// Get peak rank across all seasons
async function getPeakRankAcrossSeasons(finalsName: string) {
  const files = await getLeaderboardFiles();
  let regularPeak: any = null;
  let regularPeakSeason = '';
  let wtPeak: any = null;
  let wtPeakSeason = '';

  for (const file of files) {
    const filePath = path.resolve(__dirname, `../../cache/${file}`);
    try {
      const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
      logger.info(`[peak] Checking file: ${file}, searching for: ${finalsName}`);
      const player = findPlayer(data, finalsName);
      if (player) {
        logger.info(`[peak] Found player in ${file}:`, player);
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
      logger.info(`[peak] Error reading file ${file}:`, e);
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

  // Get linked player
  const channelInstance = await Channel.findOne({ where: { username: sanitizedChannel } });
  const playerId = channelInstance?.player_id?.trim();
  if (!playerId) {
    await ctx.say(`No THE FINALS player name linked. Use !link FinalsName#1234`);
    return;
  }

  const peaks = await getPeakRankAcrossSeasons(playerId);

  // Check for custom response
  const normalizedChannel = channel.replace(/^#/, '');
  const resp = await getCustomResponse(normalizedChannel, 'peak');
  if (resp) {
    const vars: Record<string, any> = {
      rank: peaks.regular?.rank ?? peaks.worldTour?.rank ?? "N/A",
      league: peaks.regular?.league ?? "",
      rankScore: peaks.regular?.rankScore ? peaks.regular.rankScore.toLocaleString() : "N/A",
      score: peaks.regular?.rankScore ? peaks.regular.rankScore.toLocaleString() : "N/A", // Alias
      season: peaks.regular ? seasonDisplay(peaks.regular.season) : "",
      wtRank: peaks.worldTour?.rank ?? "",
      wt_rank: peaks.worldTour?.rank ?? "", // Alias
      wtSeason: peaks.worldTour ? seasonDisplay(peaks.worldTour.season) : "",
      wt_season: peaks.worldTour ? seasonDisplay(peaks.worldTour.season) : "", // Alias
    };
    const message = resp.replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? "");
    await ctx.say(message);
    return;
  }

  if (peaks.regular && peaks.worldTour) {
    await ctx.say(
      `Peak rank: #${peaks.regular.rank} ${peaks.regular.league || ''} (${peaks.regular.rankScore?.toLocaleString() || 'N/A'} RS) in ${seasonDisplay(peaks.regular.season)} | Cashout peak: #${peaks.worldTour.rank} (${seasonDisplay(peaks.worldTour.season)})`
    );
  } else if (peaks.regular) {
    await ctx.say(
      `Peak rank: #${peaks.regular.rank} ${peaks.regular.league || ''} (${peaks.regular.rankScore?.toLocaleString() || 'N/A'} RS) in ${seasonDisplay(peaks.regular.season)}`
    );
  } else if (peaks.worldTour) {
    await ctx.say(
      `Cashout peak: #${peaks.worldTour.rank} (${seasonDisplay(peaks.worldTour.season)})`
    );
  } else {
    await ctx.say(`No peak rank found for linked account (${playerId}).`);
  }
}

function seasonDisplay(season: string) {
  if (season.startsWith('regular')) {
    return `Season ${season.replace('regular_s', '')}`;
  } else if (season.startsWith('worldTour')) {
    return `Cashout Season ${season.replace('worldTour_s', '')}`;
  }
  return season;
}
