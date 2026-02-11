/**
 * User Dashboard Routes
 * Handles user dashboard rendering and account management
 */
import { Router } from 'express';
import axios from 'axios';
import { Channel, Subscription, CustomBotAccount } from '@/db';
import logger from '@/util/logger';
import { requireUser, requireUserAPI } from '@/middleware/auth.middleware';
import { isValidPlayerId } from '@/middleware/validation.middleware';
import { getTierName } from '@/services/twitchSubscription.service';
import { csrfProtection } from '@/middleware/csrf.middleware';

const router = Router();

// Global user dashboard access toggle
let userDashboardEnabled = true;

/**
 * GET /dashboard
 * Render user dashboard with personalized data
 */
router.get("/dashboard", requireUser, csrfProtection, async (req: any, res: any) => {
    if (!userDashboardEnabled) {
        // Render auth.ejs with a message about dashboard being disabled
        return res.render("auth", {
            title: "Dashboard Disabled",
            logoPath: "/assets/logo.png",
            username: req.session?.twitchUsername || "",
            botUsername: "FinalsRS",
            message: "User dashboard is currently disabled by admin."
        });
    }

    // Fetch personalized data (example: user stats)
    let userStats: any = {};
    try {
        const user = await Channel.findOne({ where: { username: req.session.twitchUsername } });
        if (user) {
            userStats = {
                username: user.get('username'),
                twitchUserId: user.get('twitch_user_id'),
                playerId: user.get('player_id') || null,
                // Do NOT render overlay token/layout into the page. Client will request via authenticated API.
                botEnabled: user.get('bot_enabled'),
            };
        }
    } catch (err) {
        logger.error("Error fetching user stats for dashboard:", err);
    }

    // Fetch subscription and custom bot data
    let subscription = null;
    let customBot = null;
    let channel = null;
    try {
        channel = await Channel.findByPk(req.session.channelId);

        subscription = await Subscription.findOne({
            where: { channel_id: req.session.channelId }
        });

        customBot = await CustomBotAccount.findOne({
            where: { channel_id: req.session.channelId, is_active: true }
        });
    } catch (err) {
        logger.error("Error fetching subscription/bot data for dashboard:", err);
    }

    // Check if user has premium access (Twitch sub, role bypass, or manual grant)
    const role = req.session.role || 'Basic user';
    const bypassRoles = ['subscriber', 'tester', 'Staff', 'admin'];
    const hasRoleBypass = bypassRoles.includes(role);
    const hasTwitchSub = channel?.has_subscription || false;
    const hasSubscription = hasTwitchSub || hasRoleBypass;

    res.render("user-dashboard", {
        title: "FinalsRS - User dashboard",
        logoPath: "/assets/logo.png",
        username: req.session.twitchUsername,
        role,
        isAdmin: req.session.isAdmin || false,
        userStats,
        subscription,
        customBot,
        // Premium status
        hasSubscription,
        hasTwitchSub,
        hasRoleBypass,
        subscriptionTier: channel?.subscription_tier || null,
        tierName: getTierName(channel?.subscription_tier || null),
        // CSRF token for API calls
        csrfToken: req.csrfToken(),
    });
});

/**
 * POST /api/link-account
 * Link THE FINALS player ID to Twitch account
 */
router.post('/api/link-account', requireUserAPI, async (req: any, res: any) => {
    const { playerId } = req.body;

    if (!isValidPlayerId(playerId)) {
        return res.status(400).json({ error: 'Invalid player ID.' });
    }

    try {
        const username = req.session.twitchUsername;
        let channelInstance = await Channel.findOne({ where: { username } });

        if (!channelInstance) {
            await Channel.create({ username, player_id: playerId });
        } else {
            await channelInstance.update({ player_id: playerId });
        }

        res.json({ success: true });
        logger.info(`[dashboard] Linked player ID: ${playerId} for user: ${username}`);
    } catch (err) {
        logger.error('Error linking account via dashboard:', err);
        res.status(500).json({ error: 'Failed to link account.' });
    }
});

/**
 * POST /api/disconnect-bot
 * Disconnect bot/service and delete user from database
 */
router.post('/api/disconnect-bot', requireUserAPI, async (req: any, res: any) => {
    const username = req.session.twitchUsername;

    try {
        // Cache user object before deletion
        const user = await Channel.findOne({ where: { username } });

        // Notify bot process to remove channel and disconnect EventSub WebSocket FIRST
        try {
            const twitchUserId = (user as any)?.twitch_user_id;
            if (twitchUserId) {
                await axios.post('http://localhost:4000/remove-channel', {
                    twitch_user_id: twitchUserId,
                    username,
                });
                logger.info(`[dashboard] Bot notified to remove channel: ${username} (${twitchUserId})`);
            } else {
                logger.warn(`[dashboard] No twitch_user_id found for ${username}, skipping bot removal.`);
            }
        } catch (botErr) {
            logger.error(`[dashboard] Error notifying bot to remove channel for ${username}:`, botErr);
        }

        // NOW Remove channel from DB
        await Channel.destroy({ where: { username } });

        // Remove all custom responses for this user
        try {
            const { CustomResponse, RankGoal } = await import('@/db');
            await RankGoal.destroy({ where: { channel: username } });
            await CustomResponse.destroy({ where: { channel: username } });
            logger.info(`[dashboard] Deleted custom responses and rank goals for ${username}`);
        } catch (customErr) {
            logger.error(`[dashboard] Error deleting custom data for ${username}:`, customErr);
        }

        // Delete all EventSub subscriptions for this user
        try {
            const clientId = process.env.TWITCH_CLIENT_ID!;
            const accessToken = (user as any)?.access_token;

            if (accessToken) {
                const subsResp = await axios.get('https://api.twitch.tv/helix/eventsub/subscriptions', {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Client-ID': clientId,
                    }
                });

                const subs = subsResp.data.data || [];
                for (const sub of subs) {
                    await axios.delete(`https://api.twitch.tv/helix/eventsub/subscriptions?id=${sub.id}`, {
                        headers: {
                            'Authorization': `Bearer ${accessToken}`,
                            'Client-ID': clientId,
                        }
                    });
                }
                logger.info(`[dashboard] Deleted ${subs.length} EventSub subscriptions for ${username}`);
            } else {
                logger.warn(`[dashboard] No access token found for ${username}, skipping EventSub deletion.`);
            }
        } catch (eventsubErr) {
            logger.error(`[dashboard] Error deleting EventSub subscriptions for ${username}:`, eventsubErr);
        }

        // Destroy session
        req.session.destroy(() => { });
        logger.info(`[dashboard] ${username} disconnected and deleted their bot/service.`);
        res.json({ success: true });
    } catch (err) {
        logger.error('Error disconnecting bot/service:', err);
        res.status(500).json({ error: 'Failed to disconnect.' });
    }
});

/**
 * POST /api/toggle-bot
 * Toggles bot_enabled field
 */

router.post('/api/toggle-bot', requireUserAPI, async (req: any, res: any) => {
    const username = req.session.twitchUsername;
    try {
        const channelInstance = await Channel.findOne({ where: { username } });
        if (!channelInstance) {
            return res.status(404).json({ error: 'Channel not found.' });
        }
        const newState = !channelInstance.get('bot_enabled');
        await channelInstance.update({ bot_enabled: newState });

        // Notify bot process for immediate effect
        try {
            if (newState) {
                await axios.post('http://localhost:4000/add-channel', {
                    twitch_user_id: channelInstance.get('twitch_user_id'),
                    username,
                });
            } else {
                await axios.post('http://localhost:4000/remove-channel', {
                    twitch_user_id: channelInstance.get('twitch_user_id'),
                    username,
                });
            }
        } catch (botErr) {
            logger.error(`[dashboard] Error notifying bot process of status change for ${username}:`, botErr);
        }

        logger.info(`[dashboard] Toggled bot for ${username} to ${newState}`);
        res.json({ success: true, bot_enabled: newState });
    } catch (err) {
        logger.error(`[dashboard] Error toggling bot for ${username}: `, err);
        res.status(500).json({ error: 'Failed to toggle bot.' });
    }
});

/**
 * Export dashboard enable/disable functions for admin API
 */
export function isDashboardEnabled(): boolean {
    return userDashboardEnabled;
}

export function setDashboardEnabled(enabled: boolean): void {
    userDashboardEnabled = enabled;
}

export default router;