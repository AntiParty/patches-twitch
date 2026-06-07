import { Router } from 'express';
import { requireAdminAPI } from '@/middleware/auth.middleware';
import {
    getBotHealth,
    getOperationsOverview,
    parseOperationsRange,
} from '@/services/operationsAnalytics.service';
import { listAdminAuditEvents } from '@/services/operationalEvents.service';
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

router.get('/api/operations/audit', requireAdminAPI, async (req: any, res: any) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    res.json({ events: await listAdminAuditEvents(limit) });
});

export default router;
