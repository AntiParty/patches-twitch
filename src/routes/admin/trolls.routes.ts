import { Router } from 'express';
import { Channel, TrollChannel, TrollResponse } from '@/db';
import { requireStaffAPI } from '@/middleware/auth.middleware';
import { logAdminAction } from '@/util/adminLogger';
import logger from '@/util/logger';
import { VIEWER_COMMANDS } from '@/services/channelCommandSettings.service';
import {
    ANY_COMMAND,
    TROLL_PLACEHOLDERS,
    clampChance,
    formatTroll,
    normalizeTrollCommand,
} from '@/services/trollResponses.service';

// Staff-accessible (not admin-only) so trolls can be delegated without full admin.
const router = Router();
const MAX_RESPONSE_LENGTH = 400;

function actorName(req: any) {
    return String(req.session?.username || req.session?.twitchUsername || 'unknown');
}

function serialize(row: any) {
    return {
        id: row.id,
        command: row.command,
        channel: row.channel,
        response: row.response,
        chance: Number(row.chance),
        followUp: Boolean(row.follow_up),
        enabled: Boolean(row.enabled),
        createdBy: row.created_by,
        createdAt: row.created_at,
    };
}

async function resolveChannel(value: unknown): Promise<string | null | undefined> {
    const channel = String(value ?? '').replace(/^#/, '').trim().toLowerCase();
    if (!channel) return null;
    const exists = await Channel.count({ where: { username: channel } });
    return exists ? channel : undefined;
}

router.get('/api/trolls', requireStaffAPI, async (_req: any, res: any) => {
    try {
        const [trolls, armed, channels] = await Promise.all([
            TrollResponse.findAll({ order: [['created_at', 'DESC']] }),
            TrollChannel.findAll({ attributes: ['channel'] }),
            Channel.findAll({ attributes: ['username'], order: [['username', 'ASC']] }),
        ]);
        res.json({
            trolls: trolls.map(serialize),
            armedChannels: armed.map((row) => row.channel),
            // Staff can't read /api/channels, so the picker list ships here.
            channels: channels.map((row) => row.username),
            commands: [ANY_COMMAND, ...VIEWER_COMMANDS.map(({ name }) => name)],
            placeholders: TROLL_PLACEHOLDERS,
        });
    } catch (error) {
        logger.error('[Admin] Failed to list trolls:', error);
        res.status(500).json({ error: 'Failed to fetch trolls' });
    }
});

router.post('/api/trolls', requireStaffAPI, async (req: any, res: any) => {
    try {
        const command = normalizeTrollCommand(String(req.body.command || ''));
        const response = String(req.body.response || '').trim();
        if (!command || !/^[a-z0-9_*]+$/.test(command)) return res.status(400).json({ error: 'Pick a command' });
        if (!response || response.length > MAX_RESPONSE_LENGTH) {
            return res.status(400).json({ error: `Response must be 1-${MAX_RESPONSE_LENGTH} characters` });
        }
        const channel = await resolveChannel(req.body.channel);
        if (channel === undefined) return res.status(400).json({ error: 'Unknown channel' });

        const troll = await TrollResponse.create({
            command,
            channel,
            response,
            chance: clampChance(req.body.chance),
            follow_up: Boolean(req.body.followUp),
            created_by: actorName(req),
        });
        await logAdminAction(actorName(req), req.session?.role || 'admin', 'TROLL_CREATED', {
            target: channel || 'all',
            outcome: 'success',
        });
        res.json({ troll: serialize(troll) });
    } catch (error) {
        logger.error('[Admin] Failed to create troll:', error);
        res.status(500).json({ error: 'Failed to create troll' });
    }
});

router.patch('/api/trolls/:id', requireStaffAPI, async (req: any, res: any) => {
    try {
        const troll: any = await TrollResponse.findByPk(req.params.id);
        if (!troll) return res.status(404).json({ error: 'Troll not found' });

        if (req.body.enabled !== undefined) troll.enabled = Boolean(req.body.enabled);
        if (req.body.followUp !== undefined) troll.follow_up = Boolean(req.body.followUp);
        if (req.body.chance !== undefined) troll.chance = clampChance(req.body.chance);
        await troll.save();
        res.json({ troll: serialize(troll) });
    } catch (error) {
        logger.error('[Admin] Failed to update troll:', error);
        res.status(500).json({ error: 'Failed to update troll' });
    }
});

router.delete('/api/trolls/:id', requireStaffAPI, async (req: any, res: any) => {
    try {
        const deleted = await TrollResponse.destroy({ where: { id: req.params.id } });
        if (!deleted) return res.status(404).json({ error: 'Troll not found' });
        await logAdminAction(actorName(req), req.session?.role || 'admin', 'TROLL_DELETED', {
            target: String(req.params.id),
            outcome: 'success',
        });
        res.json({ success: true });
    } catch (error) {
        logger.error('[Admin] Failed to delete troll:', error);
        res.status(500).json({ error: 'Failed to delete troll' });
    }
});

router.post('/api/trolls/channels/:channel', requireStaffAPI, async (req: any, res: any) => {
    try {
        const channel = await resolveChannel(req.params.channel);
        if (!channel) return res.status(400).json({ error: 'Unknown channel' });

        if (req.body.armed) await TrollChannel.findOrCreate({ where: { channel } });
        else await TrollChannel.destroy({ where: { channel } });

        await logAdminAction(actorName(req), req.session?.role || 'admin', req.body.armed ? 'TROLLS_ARMED' : 'TROLLS_DISARMED', {
            target: channel,
            outcome: 'success',
        });
        res.json({ channel, armed: Boolean(req.body.armed) });
    } catch (error) {
        logger.error('[Admin] Failed to toggle troll channel:', error);
        res.status(500).json({ error: 'Failed to update channel' });
    }
});

router.post('/api/trolls/preview', requireStaffAPI, async (req: any, res: any) => {
    const channel = String(req.body.channel || 'somestreamer');
    const row: any = await Channel.findOne({ where: { username: channel }, attributes: ['player_id'] }).catch(() => null);
    res.json({
        text: formatTroll(String(req.body.response || ''), {
            user: 'joe',
            channel,
            ign: row?.player_id?.split('#')[0] || channel,
            command: `!${String(req.body.command || 'rank').replace(/^[!*]/, '') || 'rank'}`,
            percent: String(Math.floor(Math.random() * 101)),
        }),
    });
});

export default router;
