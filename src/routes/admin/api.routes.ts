import { Router } from 'express';
import path from 'path';
import { Channel, CustomBotAccount, Subscription } from '@/db';
import { csrfProtection } from '@/middleware/csrf.middleware';
import {
    isAdmin,
    isStaff,
    requireAdminAPI,
    requireStaff,
    requireStaffAPI,
} from '@/middleware/auth.middleware';
import logger from '@/util/logger';
import { logAdminAction } from '@/util/adminLogger';
import { botManager } from '@/botManager';
import { removeUserWebSocket } from '@/util/twitchEventSubWs';

const router = Router();
const VALID_ROLES = ['Basic user', 'tester', 'analyst', 'Staff', 'admin'];

function actor(req: any) {
    return {
        username: String(req.session?.username || req.session?.twitchUsername || 'unknown'),
        role: String(req.session?.role || (isAdmin(req) ? 'admin' : 'Staff')),
    };
}

router.get('/', csrfProtection, requireStaff, (req: any, res: any) => {
    res.sendFile(path.join(process.cwd(), 'frontend', 'views', 'admin-dashboard.html'));
});

router.get('/api/me', requireStaffAPI, (req: any, res: any) => {
    res.json({
        username: req.session.username || req.session.twitchUsername,
        role: isAdmin(req) ? 'admin' : (isStaff(req) ? 'Staff' : req.session.role),
    });
});

router.get('/api/csrf', csrfProtection, requireStaffAPI, (req: any, res: any) => {
    res.json({ csrfToken: req.csrfToken() });
});

router.get('/api/channels', requireAdminAPI, async (_req: any, res: any) => {
    try {
        const channels = await Channel.findAll({
            attributes: ['id', 'username', 'role', 'bot_enabled', 'banned'],
            order: [['username', 'ASC']],
        });
        res.json({
            channels: channels.map((channel: any) => ({
                id: channel.id,
                username: channel.username,
                role: channel.role,
                botEnabled: Boolean(channel.bot_enabled),
                banned: Boolean(channel.banned),
            })),
        });
    } catch (error) {
        logger.error('[Admin] Failed to list channels:', error);
        res.status(500).json({ error: 'Failed to fetch channels' });
    }
});

router.get('/api/users', requireAdminAPI, async (req: any, res: any) => {
    try {
        const search = String(req.query.search || '').trim().toLowerCase();
        const users = await Channel.findAll({
            attributes: [
                'id',
                'username',
                'role',
                'bot_enabled',
                'banned',
                'ban_reason',
                'has_subscription',
                'subscription_tier',
            ],
            order: [['username', 'ASC']],
        });

        const safeUsers = users
            .map((user: any) => ({
                id: user.id,
                username: user.username,
                role: user.role,
                botEnabled: Boolean(user.bot_enabled),
                banned: Boolean(user.banned),
                banReason: user.ban_reason || null,
                hasSubscription: Boolean(user.has_subscription),
                subscriptionTier: user.subscription_tier || null,
            }))
            .filter((user: any) => !search || user.username.toLowerCase().includes(search));

        res.json({ users: safeUsers });
    } catch (error) {
        logger.error('[Admin] Failed to list users:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

async function setRole(req: any, res: any, user: any, role: string) {
    if (!VALID_ROLES.includes(role)) {
        return res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
    }

    const previousRole = user.role;
    user.role = role;
    await user.save();
    const currentActor = actor(req);
    await logAdminAction(currentActor.username, currentActor.role, 'ROLE_CHANGED', {
        target: user.username,
        outcome: 'success',
    });
    res.json({ success: true, previousRole, role });
}

router.post('/api/users/set-role', requireAdminAPI, async (req: any, res: any) => {
    try {
        const user = await Channel.findOne({ where: { username: String(req.body.username || '') } });
        if (!user) return res.status(404).json({ error: 'User not found' });
        return setRole(req, res, user, String(req.body.role || ''));
    } catch (error) {
        logger.error('[Admin] Failed to change role:', error);
        res.status(500).json({ error: 'Failed to update role' });
    }
});

router.post('/api/users/:id/set-role', requireAdminAPI, async (req: any, res: any) => {
    try {
        const user = await Channel.findByPk(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        return setRole(req, res, user, String(req.body.role || ''));
    } catch (error) {
        logger.error('[Admin] Failed to change role:', error);
        res.status(500).json({ error: 'Failed to update role' });
    }
});

router.post('/api/users/:id/ban', requireAdminAPI, async (req: any, res: any) => {
    try {
        const user: any = await Channel.findByPk(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        user.banned = true;
        user.ban_reason = String(req.body.reason || 'No reason provided').slice(0, 240);
        await user.save();
        await botManager.stopBotForUser(user.username).catch((error) => {
            logger.warn(`[Admin] Could not stop bot for ${user.username}:`, error);
        });
        if (user.twitch_user_id) removeUserWebSocket(user.twitch_user_id);

        const currentActor = actor(req);
        await logAdminAction(currentActor.username, currentActor.role, 'USER_BANNED', {
            target: user.username,
            outcome: 'success',
        });
        res.json({ success: true });
    } catch (error) {
        logger.error('[Admin] Failed to ban user:', error);
        res.status(500).json({ error: 'Failed to ban user' });
    }
});

router.post('/api/users/:id/unban', requireAdminAPI, async (req: any, res: any) => {
    try {
        const user: any = await Channel.findByPk(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        user.banned = false;
        user.ban_reason = null;
        await user.save();

        const currentActor = actor(req);
        await logAdminAction(currentActor.username, currentActor.role, 'USER_UNBANNED', {
            target: user.username,
            outcome: 'success',
        });
        res.json({ success: true });
    } catch (error) {
        logger.error('[Admin] Failed to unban user:', error);
        res.status(500).json({ error: 'Failed to unban user' });
    }
});

router.post('/api/users/:id/grant-subscription', requireAdminAPI, async (req: any, res: any) => {
    try {
        const user: any = await Channel.findByPk(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const durationDays = Math.min(Math.max(Number(req.body.durationDays) || 30, 1), 365);
        const tier = String(req.body.tier || 'custom_bot').slice(0, 64);
        const periodEnd = new Date(Date.now() + durationDays * 86_400_000);

        user.has_subscription = true;
        user.subscription_tier = tier;
        await user.save();
        await Subscription.create({
            channel_id: user.id,
            status: 'active',
            plan_type: tier,
            current_period_start: new Date(),
            current_period_end: periodEnd,
            stripe_customer_id: `manual_grant_${Date.now()}`,
            stripe_subscription_id: `manual_grant_${Date.now()}`,
        });

        const currentActor = actor(req);
        await logAdminAction(currentActor.username, currentActor.role, 'SUBSCRIPTION_GRANTED', {
            target: user.username,
            outcome: 'success',
        });
        res.json({ success: true, periodEnd });
    } catch (error) {
        logger.error('[Admin] Failed to grant subscription:', error);
        res.status(500).json({ error: 'Failed to grant subscription' });
    }
});

router.post('/api/users/:id/revoke-subscription', requireAdminAPI, async (req: any, res: any) => {
    try {
        const user: any = await Channel.findByPk(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        user.has_subscription = false;
        user.subscription_tier = null;
        await user.save();
        await Subscription.update({ status: 'inactive' }, { where: { channel_id: user.id } });
        await CustomBotAccount.update({ is_active: false }, { where: { channel_id: user.id } });

        const currentActor = actor(req);
        await logAdminAction(currentActor.username, currentActor.role, 'SUBSCRIPTION_REVOKED', {
            target: user.username,
            outcome: 'success',
        });
        res.json({ success: true });
    } catch (error) {
        logger.error('[Admin] Failed to revoke subscription:', error);
        res.status(500).json({ error: 'Failed to revoke subscription' });
    }
});

router.get('/api/subscriptions', requireAdminAPI, async (_req: any, res: any) => {
    try {
        const users = await Channel.findAll({
            where: { has_subscription: true },
            attributes: ['id', 'username', 'role', 'subscription_tier'],
            order: [['username', 'ASC']],
        });
        res.json({
            subscriptions: users.map((user: any) => ({
                id: user.id,
                username: user.username,
                role: user.role,
                tier: user.subscription_tier,
            })),
        });
    } catch (error) {
        logger.error('[Admin] Failed to list subscriptions:', error);
        res.status(500).json({ error: 'Failed to fetch subscriptions' });
    }
});

export default router;
