/**
 * Admin Database Editor Routes
 * Live SQL table editor for admin panel
 */
import { Router } from 'express';
import logger from '@/util/logger';
import { requireAdminAPI } from '@/middleware/auth.middleware';

const router = Router();
const REDACTED_VALUE = '[redacted]';
const SENSITIVE_FIELD_PATTERN = /(token|secret|password|authorization|credential|oauth|api[_-]?key|cookie)/i;

function isSensitiveField(fieldName: string): boolean {
    return SENSITIVE_FIELD_PATTERN.test(fieldName);
}

export function findSensitiveAdminDbFields(data: unknown, path = ''): string[] {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return [];
    }

    return Object.entries(data).flatMap(([key, value]) => {
        const fieldPath = path ? `${path}.${key}` : key;
        if (isSensitiveField(key)) {
            return [fieldPath];
        }
        return findSensitiveAdminDbFields(value, fieldPath);
    });
}

export function redactAdminDbValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(redactAdminDbValue);
    }

    if (!value || typeof value !== 'object') {
        return value;
    }

    const redacted: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
        redacted[key] = isSensitiveField(key) ? REDACTED_VALUE : redactAdminDbValue(nestedValue);
    }

    return redacted;
}

export function redactAdminDbRow(row: any): unknown {
    const plainRow = row && typeof row.toJSON === 'function' ? row.toJSON() : row;
    return redactAdminDbValue(plainRow);
}

function rejectSensitiveAdminWrite(data: unknown, res: any): boolean {
    const sensitiveFields = findSensitiveAdminDbFields(data);
    if (sensitiveFields.length === 0) {
        return false;
    }

    res.status(400).json({
        error: 'Sensitive fields cannot be viewed or edited through the admin database editor.',
        fields: sensitiveFields
    });
    return true;
}

/**
 * GET /admin/db/:table
 * List all rows for a table
 */
router.get('/db/:table', requireAdminAPI, async (req: any, res: any) => {
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

        res.json({ rows: rows.map(redactAdminDbRow) });
    } catch (err) {
        logger.error('Error listing table rows:', err);
        res.status(500).json({ error: 'Failed to list rows.' });
    }
});

/**
 * POST /admin/db/:table
 * Create a new row in a table
 */
router.post('/db/:table', requireAdminAPI, async (req: any, res: any) => {
    const { table } = req.params;
    const data = req.body;

    try {
        if (rejectSensitiveAdminWrite(data, res)) {
            return;
        }

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

        res.json({ row: redactAdminDbRow(row) });
    } catch (err) {
        logger.error('Error creating table row:', err);
        res.status(500).json({ error: 'Failed to create row.' });
    }
});

/**
 * GET for /admin/db/StreamSessions
 * List all stream sessions with optional filters
 */

router.get('/db/StreamSessions', requireAdminAPI, async (req: any, res: any) => {
    const { channelId, limit = 30, offset = 0 } = req.query;

    try {
        const { StreamSession } = await import('@/db');

        const where: any = {};
        if (channelId) {
            where.channelId = channelId;
        }

        const sessions = await StreamSession.findAll({
            where,
            limit: parseInt(limit),
            offset: parseInt(offset),
            order: [['startTime', 'DESC']]
        });

        res.json({ sessions: sessions.map(redactAdminDbRow) });
    } catch (err) {
        logger.error('Error listing stream sessions:', err);
        res.status(500).json({ error: 'Failed to list stream sessions.' });
    }
});

/**
 * PUT /admin/db/:table/:id
 * Update a row by primary key
 */
router.put('/db/:table/:id', requireAdminAPI, async (req: any, res: any) => {
    const { table, id } = req.params;
    const data = req.body;

    try {
        if (rejectSensitiveAdminWrite(data, res)) {
            return;
        }

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
        res.json({ row: redactAdminDbRow(row) });
    } catch (err) {
        logger.error('Error updating table row:', err);
        res.status(500).json({ error: 'Failed to update row.' });
    }
});

/**
 * DELETE /admin/db/:table/:id
 * Delete a row by primary key
 */
router.delete('/db/:table/:id', requireAdminAPI, async (req: any, res: any) => {
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
