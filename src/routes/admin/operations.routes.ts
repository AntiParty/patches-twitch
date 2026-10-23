import { Router } from 'express';
import { requireAdminAPI } from '@/middleware/auth.middleware';
import {
    getBotHealth,
    getOperationsOverview,
    parseOperationsRange,
} from '@/services/operationsAnalytics.service';
import { listAdminAuditEvents } from '@/services/operationalEvents.service';
import { getProbeReport, parseProbeRange } from '@/services/probeTracker.service';
import { getLivePlayers, parseLiveTop, parseLiveWindow } from '@/services/leaderboardHistory.service';
import logger from '@/util/logger';

const router = Router();

router.get('/api/operations/overview', requireAdminAPI, async (req: any, res: any) => {
    try {
        res.json(await getOperationsOverview(parseOperationsRange(req.query.range)));
    } catch (error) {
        logger.error('[Operations] Failed to build overview:', error);
        res.status(500).json({ error: 'Failed to load operations overview' });
    }
});

router.get('/api/operations/health', requireAdminAPI, async (req: any, res: any) => {
    try {
        res.json(await getBotHealth(parseOperationsRange(req.query.range)));
    } catch (error) {
        logger.error('[Operations] Failed to build health data:', error);
        res.status(500).json({ error: 'Failed to load bot health' });
    }
});

router.get('/api/operations/probes', requireAdminAPI, async (req: any, res: any) => {
    try {
        res.json(await getProbeReport(parseProbeRange(req.query.range)));
    } catch (error) {
        logger.error('[Operations] Failed to build probe report:', error);
        res.status(500).json({ error: 'Failed to load probe report' });
    }
});

router.get('/api/operations/live-players', requireAdminAPI, async (req: any, res: any) => {
    try {
        res.json(await getLivePlayers(parseLiveWindow(req.query.window), parseLiveTop(req.query.top)));
    } catch (error) {
        logger.error('[Operations] Failed to load live players:', error);
        res.status(500).json({ error: 'Failed to load live players' });
    }
});

router.get('/api/operations/audit', requireAdminAPI, async (req: any, res: any) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    res.json({ events: await listAdminAuditEvents(limit) });
});

export default router;
