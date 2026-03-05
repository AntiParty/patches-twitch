import fs from 'fs/promises';
import path from 'path';
import logger from '@/util/logger';
import { Channel, PeakRank } from '@/db';
import { Op } from 'sequelize';

const CACHE_DIR = path.resolve(__dirname, '../../cache');

function normalizeName(name: string): string {
  return name?.toLowerCase().trim() || '';
}

function findPlayer(data: any[], target: string): any | null {
  const normalized = normalizeName(target);
  const fields = ['name', 'steamName', 'psnName', 'xboxName'];
  const normalize = (v: any) => (v ? v.toLowerCase().trim() : '');

  // Exact match
  for (const player of data) {
    for (const f of fields) {
      if (normalize(player[f]) === normalized) return player;
    }
  }

  // Fallback: base name match (before #)
  if (normalized.includes('#')) {
    const base = normalized.split('#')[0];
    for (const player of data) {
      for (const f of fields) {
        if (normalize(player[f]).startsWith(base)) return player;
      }
    }
  }

  return null;
}

async function loadAllCacheFiles(): Promise<{ file: string; data: any[] }[]> {
  const files = await fs.readdir(CACHE_DIR);
  const leaderboardFiles = files.filter(f => /^(regular_s\d+|worldTour_s\d+)\.json$/.test(f));

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

    let bestRegular: { rank: number; rs: number; league: string; season: string } | null = null;
    let bestWT: { rank: number; season: string } | null = null;

    for (const { file, data } of leaderboards) {
      const player = findPlayer(data, playerId);
      if (!player) continue;

      if (file.startsWith('regular')) {
        if (!bestRegular || player.rank < bestRegular.rank) {
          bestRegular = {
            rank: player.rank,
            rs: player.rankScore,
            league: player.league || null,
            season: file,
          };
        }
      } else if (file.startsWith('worldTour')) {
        if (!bestWT || player.rank < bestWT.rank) {
          bestWT = { rank: player.rank, season: file };
        }
      }
    }

    if (!bestRegular && !bestWT) continue;

    // Only update if we found a better peak than what's stored
    const existing = await PeakRank.findOne({ where: { channel: (channel as any).username } });

    const updateData: any = {
      channel: (channel as any).username,
      player_id: playerId,
      updated_at: new Date(),
    };

    if (bestRegular) {
      if (!existing || !(existing as any).regular_rank || bestRegular.rank < (existing as any).regular_rank) {
        updateData.regular_rank = bestRegular.rank;
        updateData.regular_rs = bestRegular.rs;
        updateData.regular_league = bestRegular.league;
        updateData.regular_season = bestRegular.season;
      }
    }

    if (bestWT) {
      if (!existing || !(existing as any).wt_rank || bestWT.rank < (existing as any).wt_rank) {
        updateData.wt_rank = bestWT.rank;
        updateData.wt_season = bestWT.season;
      }
    }

    await PeakRank.upsert(updateData);
    updated++;
  }

  logger.info(`[peakUpdater] Updated peak ranks for ${updated} channels`);
}
