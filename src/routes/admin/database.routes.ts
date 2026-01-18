/**
 * Admin Database Editor Routes
 * Live SQL table editor for admin panel
 */
import { Router } from 'express';
import logger from '@/util/logger';
import { requireAdminAPI } from '@/middleware/auth.middleware';

const router = Router();

/**
 * GET /admin/api/db/:table
 * List all rows for a table
 */
router.get('/api/db/:table', requireAdminAPI, async (req: any, res: any) => {
    const { table } = req.params;

    try {
        let rows;

        if (table === 'StreamSessions') {
            const { StreamSession } = await import('@/db');
            rows = await StreamSession.findAll();
        } else if (table === 'Channels') {
            const { Channel } = await import('@/db');
            rows = await Channel.findAll();
        } else if (table === 'CustomResponse') {
            const { CustomResponse } = await import('@/db');
            rows = await CustomResponse.findAll();
        } else if (table === 'RankGoals') {
            const { RankGoal } = await import('@/db');
            rows = await RankGoal.findAll();
        } else if (table === 'CommandUsage') {
            const { CommandUsage } = await import('@/db');
            // Limit to last 500 to prevent crashing the browser
            rows = await CommandUsage.findAll({ limit: 30, order: [['timestamp', 'DESC']] });
        } else {
            return res.status(400).json({ error: 'Unknown table' });
        }

        res.json({ rows });
    } catch (err) {
        logger.error('Error listing table rows:', err);
        res.status(500).json({ error: 'Failed to list rows.' });
    }
});

/**
 * POST /admin/api/db/:table
 * Create a new row in a table
 */
router.post('/api/db/:table', requireAdminAPI, async (req: any, res: any) => {
    const { table } = req.params;
    const data = req.body;

    try {
        let row;

        if (table === 'StreamSessions') {
            const { StreamSession } = await import('@/db');
            row = await StreamSession.create(data);
        } else if (table === 'Channels') {
            const { Channel } = await import('@/db');
            row = await Channel.create(data);
        } else if (table === 'CustomResponse') {
            const { CustomResponse } = await import('@/db');
            row = await CustomResponse.create(data);
        } else if (table === 'RankGoals') {
            const { RankGoal } = await import('@/db');
            row = await RankGoal.create(data);
        } else if (table === 'CommandUsage') {
            const { CommandUsage } = await import('@/db');
            row = await CommandUsage.create(data);
        } else {
            return res.status(400).json({ error: 'Unknown table' });
        }

        res.json({ row });
    } catch (err) {
        logger.error('Error creating table row:', err);
        res.status(500).json({ error: 'Failed to create row.' });
    }
});

/**
 * PUT /admin/api/db/:table/:id
 * Update a row by primary key
 */
router.put('/api/db/:table/:id', requireAdminAPI, async (req: any, res: any) => {
    const { table, id } = req.params;
    const data = req.body;

    try {
        let model;

        if (table === 'StreamSessions') {
            const { StreamSession } = await import('@/db');
            model = StreamSession;
        } else if (table === 'Channels') {
            const { Channel } = await import('@/db');
            model = Channel;
        } else if (table === 'CustomResponse') {
            const { CustomResponse } = await import('@/db');
            model = CustomResponse;
        } else if (table === 'RankGoals') {
            const { RankGoal } = await import('@/db');
            model = RankGoal;
        } else if (table === 'CommandUsage') {
            const { CommandUsage } = await import('@/db');
            model = CommandUsage;
        } else {
            return res.status(400).json({ error: 'Unknown table' });
        }

        const row = await model.findByPk(id);
        if (!row) {
            return res.status(404).json({ error: 'Row not found' });
        }

        await row.update(data);
        res.json({ row });
    } catch (err) {
        logger.error('Error updating table row:', err);
        res.status(500).json({ error: 'Failed to update row.' });
    }
});

/**
 * DELETE /admin/api/db/:table/:id
 * Delete a row by primary key
 */
router.delete('/api/db/:table/:id', requireAdminAPI, async (req: any, res: any) => {
    const { table, id } = req.params;

    try {
        let model;

        if (table === 'StreamSessions') {
            const { StreamSession } = await import('@/db');
            model = StreamSession;
        } else if (table === 'Channels') {
            const { Channel } = await import('@/db');
            model = Channel;
        } else if (table === 'CustomResponse') {
            const { CustomResponse } = await import('@/db');
            model = CustomResponse;
        } else if (table === 'RankGoals') {
            const { RankGoal } = await import('@/db');
            model = RankGoal;
        } else if (table === 'CommandUsage') {
            const { CommandUsage } = await import('@/db');
            model = CommandUsage;
        } else {
            return res.status(400).json({ error: 'Unknown table' });
        }

        const row = await model.findByPk(id);
        if (!row) {
            return res.status(404).json({ error: 'Row not found' });
        }

        await row.destroy();
        res.json({ success: true });
    } catch (err) {
        logger.error('Error deleting table row:', err);
        res.status(500).json({ error: 'Failed to delete row.' });
    }
});

export default router;
