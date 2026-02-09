/**
 * User Analytics Routes
 * Handles command usage analytics for users
 */
import { Router } from 'express';
import logger from '@/util/logger';
import { requireUserAPI } from '@/middleware/auth.middleware';
import { getCommandAnalytics } from '@/util/commandAnalytics';

const router = Router();

/**
 * GET /api/my-analytics
 * Get command analytics for the authenticated user's channel
 */
router.get('/api/my-analytics', requireUserAPI, async (req: any, res: any) => {
  try {
    const username = req.session.twitchUsername;
    if (!username) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Parse query parameters
    const startDate = req.query.startDate ? new Date(req.query.startDate) : undefined;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : undefined;
    const command = req.query.command as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;

    // Get analytics
    const analytics = await getCommandAnalytics(username, {
      startDate,
      endDate,
      command,
      limit,
    });

    res.json(analytics);
  } catch (err) {
    logger.error('Error fetching command analytics:', err);
    res.status(500).json({ error: 'Failed to fetch analytics.' });
  }
});

/**
 * GET /api/my-analytics/summary
 * Get a summary of command analytics (last 7 days, 30 days, 60 days, all time)
 */
router.get('/api/my-analytics/summary', requireUserAPI, async (req: any, res: any) => {
  try {
    const username = req.session.twitchUsername;
    if (!username) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    // Get analytics for different time periods
    const [last7Days, last30Days, last60Days, allTime] = await Promise.all([
      getCommandAnalytics(username, { startDate: sevenDaysAgo }),
      getCommandAnalytics(username, { startDate: thirtyDaysAgo }),
      getCommandAnalytics(username, { startDate: sixtyDaysAgo }),
      getCommandAnalytics(username, {}),
    ]);

    res.json({
      last7Days,
      last30Days,
      last60Days,
      allTime,
    });
  } catch (err) {
    logger.error('Error fetching analytics summary:', err);
    res.status(500).json({ error: 'Failed to fetch analytics summary.' });
  }
});

export default router;
