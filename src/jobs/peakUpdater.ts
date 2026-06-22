import fs from 'fs/promises';
import path from 'path';
import logger from '@/util/logger';
import { Channel, PeakRank } from '@/db';
import { Op } from 'sequelize';
import { searchPlayer } from '@/util/leaderboardSearch';

const CACHE_DIR = path.resolve(__dirname, '../../cache');

/**
 * First season whose RS values are on the current, comparable scale.
 * S1–S2 were league-only (no RS) and S3 used a different RS scale, so their
 * scores must not be compared against modern seasons. Mirrors the predictor's
 * CROSS_SEASON_MIN_FIRST in rsPredictor.ts.
 */
export const RS_COMPARABLE_MIN_SEASON = 4;

export interface SeasonRSEntry {
  season: number;          // numeric season, e.g. 9
  file: string;            // cache file id, e.g. "regular_s9"
  rank: number;
  rankScore: number;
  league: string | null;
}

/**
 * Picks a player's peak as the season with their HIGHEST RS, considering only
 * seasons with comparable RS (S4+). Returns null if no comparable season has a
 * numeric RS. Rank/league/season come from that same highest-RS season.
 */
export function selectPeakByRS(entries: SeasonRSEntry[]): SeasonRSEntry | null {
  let best: SeasonRSEntry | null = null;
  for (const e of entries) {
    if (e.season < RS_COMPARABLE_MIN_SEASON) continue;
    if (typeof e.rankScore !== 'number' || !Number.isFinite(e.rankScore)) continue;
    if (!best || e.rankScore > best.rankScore) best = e;
  }
  return best;
}

async function loadAllCacheFiles(): Promise<{ file: string; data: any[] }[]> {
  const files = await fs.readdir(CACHE_DIR);
  const leaderboardFiles = files.filter(f => /^regular_s\d+\.json$/.test(f));

  const results: { file: string; data: any[] }[] = [];
  for (const file of leaderboardFiles) {
    try {
      const raw = await fs.readFile(path.join(CACHE_DIR, file), 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) results.push({ file: file.replace('.json', ''), data });
    } catch {
      // Skip unreadable files
    }
  }
  return results;
}

export async function updatePeakRanks(): Promise<void> {
  const channels = await Channel.findAll({
    where: { player_id: { [Op.ne]: null } },
    attributes: ['username', 'player_id'],
  });

  if (channels.length === 0) return;

  const leaderboards = await loadAllCacheFiles();
  if (leaderboards.length === 0) {
    logger.warn('[peakUpdater] No cache files found, skipping peak update');
    return;
  }

  let updated = 0;

  for (const channel of channels) {
    const playerId = (channel as any).player_id;
    if (!playerId) continue;

    // Gather this player's standing in every cached season, then pick their
    // highest-RS season as the peak (rank position varies with how stacked a
    // season was; RS is the truer personal best).
    const entries: SeasonRSEntry[] = [];
    for (const { file, data } of leaderboards) {
      const player = searchPlayer(data, playerId);
      if (!player) continue;
      entries.push({
        season: parseInt(file.match(/\d+/)?.[0] ?? '0', 10),
        file,
        rank: player.rank,
        rankScore: player.rankScore,
        league: player.league || null,
      });
    }

    const bestRegular = selectPeakByRS(entries);
    if (!bestRegular) continue;

    // Only update when we've found a higher RS than what's stored (peak is monotonic by RS).
    const existing = await PeakRank.findOne({ where: { channel: (channel as any).username } });

    const updateData: any = {
      channel: (channel as any).username,
      player_id: playerId,
      updated_at: new Date(),
    };

    if (!existing || (existing as any).regular_rs == null || bestRegular.rankScore > (existing as any).regular_rs) {
      updateData.regular_rank = bestRegular.rank;
      updateData.regular_rs = bestRegular.rankScore;
      updateData.regular_league = bestRegular.league;
      updateData.regular_season = bestRegular.file;
    }

    await PeakRank.upsert(updateData);
    updated++;
  }

  logger.info(`[peakUpdater] Updated peak ranks for ${updated} channels`);
}
