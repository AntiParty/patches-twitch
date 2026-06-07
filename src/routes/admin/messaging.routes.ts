import { Router } from 'express';
import axios from 'axios';
import { Channel } from '@/db';
import { requireAdminAPI } from '@/middleware/auth.middleware';
import { logAdminAction } from '@/util/adminLogger';
import logger from '@/util/logger';

const router = Router();
const MAX_CHANNELS = 20;
const MAX_MESSAGE_LENGTH = 450;
const sendWindows = new Map<string, number>();

export function validateMessageRequest(body: any): { channels?: string[]; message?: string; error?: string } {
    const channels: string[] = Array.isArray(body?.channels)
        ? body.channels.map((value: unknown) => String(value).trim().toLowerCase())
        : [];
    const message = String(body?.message || '').trim();

    if (channels.length === 0) return { error: 'Select at least one channel' };
    if (channels.length > MAX_CHANNELS) return { error: `Select no more than ${MAX_CHANNELS} channels` };
    if (channels.some((channel) => !channel || channel === '*' || channel === 'all')) {
        return { error: 'Only explicitly selected channels are allowed' };
    }
    if (!message || message.length > MAX_MESSAGE_LENGTH) {
        return { error: `Message must be 1-${MAX_MESSAGE_LENGTH} characters` };
    }
    if (new Set(channels).size !== channels.length) return { error: 'Duplicate channels are not allowed' };
    return { channels, message };
}

router.post('/api/message', requireAdminAPI, async (req: any, res: any) => {
    const validated = validateMessageRequest(req.body);
    if (validated.error) return res.status(400).json({ error: validated.error });
    const channels = validated.channels!;
    const message = validated.message!;

    const actor = String(req.session?.username || req.session?.twitchUsername || 'unknown');
    const lastSend = sendWindows.get(actor) || 0;
    if (Date.now() - lastSend < 3000) return res.status(429).json({ error: 'Please wait before sending another message' });

    const existingChannels = await Channel.findAll({
        where: { username: channels },
        attributes: ['username'],
        raw: true,
    }) as any[];
    const allowed = new Set(existingChannels.map((channel) => String(channel.username).toLowerCase()));
    const unknown = channels.filter((channel) => !allowed.has(channel));
    if (unknown.length > 0) return res.status(400).json({ error: 'One or more selected channels are invalid' });

    sendWindows.set(actor, Date.now());
    const results = await Promise.all(channels.map(async (channel) => {
        try {
            await axios.post('http://127.0.0.1:4000/send-message', { channel, message }, { timeout: 5000 });
            return { channel, success: true };
        } catch {
            return { channel, success: false };
        }
    }));

    await logAdminAction(actor, req.session?.role || 'admin', 'BOT_MESSAGE_REQUESTED', {
        target: channels.join(','),
        outcome: results.every((result) => result.success) ? 'success' : 'partial',
    });
    logger.info(`[Admin] ${actor} requested a bot message for ${channels.length} selected channel(s)`);
    res.status(results.some((result) => result.success) ? 200 : 502).json({ results });
});

export default router;
