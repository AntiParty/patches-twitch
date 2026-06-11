import { getLatestLeaderboardData } from '@/commands/record';

export async function getCurrentRankedScore(playerId: string): Promise<number | null> {
  const data = await getLatestLeaderboardData();
  if (!data) return null;
  const normalized = playerId.toLowerCase();
  let player = data.find((item: any) => String(item.name).toLowerCase() === normalized);
  if (!player && normalized.includes('#')) {
    const baseName = normalized.split('#')[0];
    player = data.find((item: any) => String(item.name).toLowerCase().startsWith(baseName));
  }
  return Number.isFinite(player?.rankScore) ? Number(player.rankScore) : null;
}
