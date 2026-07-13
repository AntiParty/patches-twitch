/**
 * Onboarding Routes
 * - GET  /api/onboarding/lookup?ign=  read-only leaderboard preview for the wizard
 * - POST /api/onboarding/complete     marks the first-run wizard done (finish or skip)
 */
import { Router } from 'express';
import { Channel } from '@/db';
import logger from '@/util/logger';
import { requireUserAPI } from '@/middleware/auth.middleware';
import { csrfProtection } from '@/middleware/csrf.middleware';
import { isValidPlayerId } from '@/middleware/validation.middleware';
import { searchPlayer } from '@/util/leaderboardSearch';
import { getLatestLeaderboardData } from '@/commands/record';

const router = Router();

export interface LookupResult {
  found: boolean;
  name?: string;
  rank?: number;
  rankScore?: number;
  league?: string;
}

/** Pure matcher wrapper so the shape is unit-testable without HTTP. */
export function buildLookupResult(data: any[] | null, ign: string): LookupResult {
  const player = searchPlayer(data, ign);
  if (!player) return { found: false };
  return {
    found: true,
    name: player.name,
    rank: player.rank,
    rankScore: player.rankScore,
    league: player.league,
  };
}

router.get('/api/onboarding/lookup', requireUserAPI, async (req: any, res: any) => {
  const ign = String(req.query.ign || '').trim();
  if (!isValidPlayerId(ign)) {
    return res.status(400).json({ error: 'Invalid Embark ID.' });
  }
  try {
    const data = await getLatestLeaderboardData();
    return res.json(buildLookupResult(data, ign));
  } catch (err) {
    logger.error('[Onboarding] lookup failed:', err);
    return res.status(500).json({ error: 'Lookup failed.' });
  }
});

router.post('/api/onboarding/complete', requireUserAPI, csrfProtection, async (req: any, res: any) => {
  try {
    const username = req.session.twitchUsername;
    await Channel.update(
      { onboarding_completed_at: new Date() } as any,
      { where: { username } },
    );
    logger.info(`[Onboarding] ${username} completed/dismissed onboarding.`);
    return res.json({ success: true });
  } catch (err) {
    logger.error('[Onboarding] complete failed:', err);
    return res.status(500).json({ error: 'Failed to save onboarding state.' });
  }
});

export default router;
