/**
 * One-time peak-rank recompute.
 *
 * The peak job previously matched players with a looser algorithm than the
 * `!rank` command, which could record the wrong player's rank. Because peaks are
 * only ever overwritten by a *better* rank, those bad values never self-correct.
 *
 * This script wipes the PeakRanks table and rebuilds it from the current cached
 * leaderboard snapshots using the fixed matcher. Intra-season peaks that were
 * captured live in past runs but are not present in the frozen snapshots are
 * lost, and re-accumulate going forward.
 *
 * Run manually (e.g. on prod):  bun run src/scripts/recomputePeaks.ts
 */
import { PeakRank, dbReady } from '@/db';
import { updatePeakRanks } from '@/jobs/peakUpdater';
import logger from '@/util/logger';

async function main() {
  await dbReady;

  const before = await PeakRank.count();
  logger.info(`[recomputePeaks] Clearing ${before} stored peak rows…`);
  await PeakRank.destroy({ where: {}, truncate: true });

  logger.info('[recomputePeaks] Recomputing peaks from cached snapshots…');
  await updatePeakRanks();

  const after = await PeakRank.count();
  logger.info(`[recomputePeaks] Done. ${after} peak rows rebuilt.`);
  process.exit(0);
}

main().catch((err) => {
  logger.error('[recomputePeaks] Failed:', err);
  process.exit(1);
});
