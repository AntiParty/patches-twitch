/**
 * User Rank Goal Routes
 * Handles rank goal tracking for THE FINALS streamers
 */
import { Router } from 'express';
import logger from '@/util/logger';
import { requireUserAPI } from '@/middleware/auth.middleware';
import { isValidRank, isValidRankScore } from '@/middleware/validation.middleware';

const router = Router();

// Rank thresholds for THE FINALS
// 1=Bronze, 2=Silver, 3=Gold, 4=Platinum, 5=Diamond, 6=Ruby (Top 500)
const RANK_THRESHOLDS: { [key: number]: number } = {
    1: 0,      // Bronze: 0 - 9,999
    2: 10000,  // Silver: 10,000 - 19,999
    3: 20000,  // Gold: 20,000 - 29,000
    4: 30000,  // Platinum: 30,000 - 39,000
    5: 40000,  // Diamond: 40,000+
    6: 999999  // Ruby: Top 500 (dynamic threshold, unlocks mid-season)
};

/**
 * GET /api/my-rank-goal
 * Fetch the current rank goal for the authenticated user
 */
router.get('/api/my-rank-goal', requireUserAPI, async (req: any, res: any) => {
    try {
        const username = req.session.twitchUsername;
        const { RankGoal } = await import('@/db');

        const goal = await RankGoal.findOne({
            where: { channel: username }
        });

        if (!goal) {
            return res.json({ goal: null });
        }

        res.json({
            goal: {
                targetRank: goal.get('target_rank'),
                targetRankScore: goal.get('target_rank_score'),
                startingRank: goal.get('starting_rank'),
                startingRankScore: goal.get('starting_rank_score'),
                createdAt: goal.get('created_at'),
                achieved: goal.get('achieved'),
                achievedAt: goal.get('achieved_at')
            }
        });
    } catch (err) {
        logger.error('Error fetching rank goal:', err);
        res.status(500).json({ error: 'Failed to fetch rank goal.' });
    }
});

/**
 * POST /api/my-rank-goal
 * Create or update a rank goal for the authenticated user
 */
router.post('/api/my-rank-goal', requireUserAPI, async (req: any, res: any) => {
    try {
        const username = req.session.twitchUsername;
        const { targetRank, currentRS } = req.body;

        // Validate input
        if (!isValidRank(targetRank)) {
            return res.status(400).json({ error: 'Invalid target rank.' });
        }

        if (!isValidRankScore(currentRS)) {
            return res.status(400).json({ error: 'Invalid current RS.' });
        }

        const targetRS = RANK_THRESHOLDS[targetRank] || 50000;

        const { RankGoal } = await import('@/db');

        // Upsert the rank goal
        await RankGoal.upsert({
            channel: username,
            target_rank: targetRank,
            target_rank_score: targetRS,
            starting_rank: null, // Can be derived from current game stats if available
            starting_rank_score: currentRS,
            created_at: new Date(),
            achieved: currentRS >= targetRS,
            achieved_at: currentRS >= targetRS ? new Date() : null
        });

        logger.info(`[dashboard] ${username} set rank goal: target=${targetRank}, currentRS=${currentRS}`);
        res.json({ success: true });
    } catch (err) {
        logger.error('Error setting rank goal:', err);
        res.status(500).json({ error: 'Failed to set rank goal.' });
    }
});

/**
 * DELETE /api/my-rank-goal
 * Delete the rank goal for the authenticated user
 */
router.delete('/api/my-rank-goal', requireUserAPI, async (req: any, res: any) => {
    try {
        const username = req.session.twitchUsername;
        const { RankGoal } = await import('@/db');

        const deleted = await RankGoal.destroy({
            where: { channel: username }
        });

        if (deleted === 0) {
            return res.status(404).json({ error: 'No rank goal found to delete.' });
        }

        logger.info(`[dashboard] ${username} deleted their rank goal`);
        res.json({ success: true });
    } catch (err) {
        logger.error('Error deleting rank goal:', err);
        res.status(500).json({ error: 'Failed to delete rank goal.' });
    }
});

export default router;
