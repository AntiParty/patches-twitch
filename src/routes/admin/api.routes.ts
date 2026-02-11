/**
 * Admin API Routes
 * Core admin functionality and bot management
 */
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { exec } from 'child_process';
import { Channel } from '@/db';
import logger from '@/util/logger';
import { performanceMonitor } from '@/util/performanceMonitor';
import { refreshBotToken } from '@/util/botAuth';
import { reconnectChatBot, clients, stopChatBot } from '@/util/ircBot';
import { loadCommands } from '@/handlers/commands';
import { getCommandAnalytics } from '@/util/commandAnalytics';
import multer from 'multer';
import { requireAdminAPI, isAdmin, isStaff, requireApiKey, requireStaff, requireStaffAPI } from '@/middleware/auth.middleware';
import { csrfProtection } from '@/middleware/csrf.middleware';
import { isDashboardEnabled, setDashboardEnabled } from '@/routes/user/dashboard.routes';
import { logAdminAction } from '@/util/adminLogger';
import { removeUserWebSocket } from '@/util/twitchEventSubWs';
import { botManager } from '@/botManager';

const router = Router();

// Setup Multer for image uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(process.cwd(), 'frontend', 'public', 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'drop-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only images are allowed'));
        }
    }
});

// Track server start time for uptime calculation
const serverStartTime = Date.now();

/**
 * GET /admin
 * Render admin dashboard page (Staff or Admin)
 * Redirects analysts to statistics dashboard
 */
router.get('/', csrfProtection, async (req: any, res: any) => {
    const { isAnalyst, isStaff, requireStaff } = await import('@/middleware/auth.middleware');
    
    // Check if user is analyst (but not staff/admin)
    // Analysts get redirected to statistics dashboard
    if (isAnalyst(req) && !isStaff(req)) {
        return res.redirect('/statistics');
    }
    
    // Require staff for admin dashboard
    await requireStaff(req, res, () => {
        const viewsPath = path.join(process.cwd(), 'frontend', 'views');
        res.sendFile(path.join(viewsPath, 'admin-dashboard.html'));
    });
});

/**
 * GET /admin/statistics
 * Redirect to /statistics (backward compatibility)
 */
router.get('/statistics', (req: any, res: any) => {
    res.redirect('/statistics');
});

/**
 * GET /admin/api/me
 * Get current user info and role
 */
router.get('/api/me', requireStaffAPI, (req: any, res: any) => {
    res.json({
        username: req.session.username,
        role: req.session.role || (isAdmin(req) ? 'admin' : 'Staff')
    });
});

/**
 * GET /admin/api/csrf
 * Provide CSRF token for AJAX clients
 */
router.get('/api/csrf', csrfProtection, (req: any, res: any) => {
    res.json({ csrfToken: req.csrfToken() });
});

/**
 * Simple User Management (Temp JSON)
 */
router.get('/api/simple-users', requireAdminAPI, async (req: any, res: any) => {
    const { getAllSimpleUsers } = await import('@/util/simpleUsers');
    const users = await getAllSimpleUsers();
    // Return users without password hash
    const safeUsers = users.map(u => ({ username: u.username, role: u.role, createdAt: u.createdAt }));
    res.json(safeUsers);
});

router.post('/api/simple-users', requireAdminAPI, async (req: any, res: any) => {
    const { username, password, role } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    
    const { addSimpleUser } = await import('@/util/simpleUsers');
    const success = await addSimpleUser(username, password, role || 'analyst');
    
    if (success) {
        logAdminAction(req.session.username, 'ADD_SIMPLE_USER', `Added user ${username} as ${role}`);
        res.json({ success: true });
    } else {
        res.status(400).json({ error: 'User already exists or failed to create' });
    }
});

router.delete('/api/simple-users/:username', requireAdminAPI, async (req: any, res: any) => {
    const { removeSimpleUser } = await import('@/util/simpleUsers');
    const success = await removeSimpleUser(req.params.username);
    
    if (success) {
        logAdminAction(req.session.username, 'REMOVE_SIMPLE_USER', `Removed user ${req.params.username}`);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'User not found' });
    }
});

/**
 * GET /admin/api/stats
 * Get server statistics summary
 */
router.get('/api/stats', requireStaffAPI, async (req: any, res: any) => {
    // Import dynamically to avoid circular dependencies
    const { getCommandsProcessed } = await import('@/server');

    res.json({
        user: req.session.username,
        stats: {
            commandsProcessed: getCommandsProcessed(),
            uptime: Math.floor((Date.now() - serverStartTime) / 1000),
        },
    });
});

/**
 * GET /admin/api/channels
 * List all connected channels
 */
router.get('/api/channels', requireAdminAPI, async (req: any, res: any) => {
    try {
        const channels = await Channel.findAll({ attributes: ['username', 'role'] });
        res.status(200).json({ 
            userCount: channels.length, 
            channels: channels.map((c: any) => ({
                username: c.username,
                role: c.role
            }))
        });
    } catch (err) {
        logger.error("Error fetching channels list:", err);
        res.status(500).json({ error: "Failed to fetch channels" });
    }
});

/**
 * GET /admin/api/users
 * List all users with their roles
 */
router.get('/api/users', requireAdminAPI, async (req: any, res: any) => {
    try {
        const users = await Channel.findAll({
            attributes: ['id', 'username', 'role', 'twitch_user_id', 'banned', 'ban_reason']
        });
        res.json({ users });
    } catch (err) {
        logger.error('Error fetching users:', err);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

/**
 * POST /admin/api/users/set-role
 * Set a user's role
 */
router.post('/api/users/set-role', requireAdminAPI, async (req: any, res: any) => {
    const { username, role } = req.body;
    const validRoles = ['Basic user', 'tester', 'analyst', 'Staff', 'admin'];

    if (!username || !role) {
        return res.status(400).json({ error: 'Username and role are required' });
    }

    if (!validRoles.includes(role)) {
        return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
    }

    try {
        const user = await Channel.findOne({ where: { username } });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user.role = role;
        await user.save();

        await logAdminAction(req.session.username, req.session.role || 'admin', 'SET_USER_ROLE', { target: username, role });
        logger.info(`[Admin] Role for user ${username} set to ${role} by ${req.session.username || 'admin'}`);
        res.json({ success: true, message: `Role for ${username} updated to ${role}` });
    } catch (err) {
        logger.error('Error updating user role:', err);
        res.status(500).json({ error: 'Failed to update user role' });
    }
});

/**
 * POST /admin/api/users/:id/ban
 * Ban a user
 */
router.post('/api/users/:id/ban', requireAdminAPI, async (req: any, res: any) => {
    const userId = req.params.id;
    const { reason } = req.body;

    try {
        const user = await Channel.findByPk(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const username = user.username;
        const twitchUserId = (user as any).twitch_user_id;

        // Update ban status in database
        user.banned = true;
        user.ban_reason = reason || 'No reason provided';
        await user.save();

        // Stop the bot for this user
        try {
            await botManager.stopBotForUser(username);
            logger.info(`[Admin] Stopped bot for banned user ${username}`);
        } catch (err) {
            logger.error(`[Admin] Failed to stop bot for ${username}:`, err);
        }

        // Remove EventSub subscriptions
        if (twitchUserId) {
            try {
                removeUserWebSocket(twitchUserId);
                logger.info(`[Admin] Removed EventSub subscriptions for banned user ${username}`);
            } catch (err) {
                logger.error(`[Admin] Failed to remove EventSub for ${username}:`, err);
            }
        }

        await logAdminAction(req.session.username, req.session.role || 'admin', 'BAN_USER', { targetId: userId, reason });
        logger.info(`[Admin] User ${username} (${userId}) banned by ${req.session.username || 'admin'}: ${reason}`);
        res.json({ success: true, message: `User ${username} banned and disconnected.` });
    } catch (err) {
        logger.error('Error banning user:', err);
        res.status(500).json({ error: 'Failed to ban user' });
    }
});

/**
 * POST /admin/api/users/:id/unban
 * Unban a user
 */
router.post('/api/users/:id/unban', requireAdminAPI, async (req: any, res: any) => {
    const userId = req.params.id;

    try {
        const user = await Channel.findByPk(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const username = user.username;
        const accessToken = (user as any).access_token;
        const refreshToken = (user as any).refresh_token;
        const twitchUserId = (user as any).twitch_user_id;

        // Update ban status in database
        user.banned = false;
        user.ban_reason = null;
        await user.save();

        // Restart the bot for this user if they have valid tokens
        if (accessToken && refreshToken && twitchUserId) {
            try {
                await botManager.startBotForUser(username, accessToken, refreshToken, twitchUserId);
                logger.info(`[Admin] Restarted bot for unbanned user ${username}`);
            } catch (err) {
                logger.error(`[Admin] Failed to restart bot for ${username}:`, err);
            }
        }

        await logAdminAction(req.session.username, req.session.role || 'admin', 'UNBAN_USER', { targetId: userId });
        logger.info(`[Admin] User ${username} (${userId}) unbanned by ${req.session.username || 'admin'}`);
        res.json({ success: true, message: `User ${username} unbanned and reconnected.` });
    } catch (err) {
        logger.error('Error unbanning user:', err);
        res.status(500).json({ error: 'Failed to unban user' });
    }
});

/**
 * POST /admin/api/users/:id/grant-subscription
 * Manually grant a subscription to a user
 */
router.post('/api/users/:id/grant-subscription', requireAdminAPI, async (req: any, res: any) => {
    const userId = req.params.id;
    const { durationDays, tier } = req.body;

    // Default to 30 days if not specified
    const duration = durationDays ? parseInt(durationDays) : 30;
    const subscriptionTier = tier || 'custom_bot';

    try {
        const user = await Channel.findByPk(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Update user subscription status
        user.has_subscription = true;
        user.subscription_tier = subscriptionTier;
        await user.save();

        // Create or update subscription record for tracking
        const { Subscription } = await import('@/db');
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + duration);

        await Subscription.create({
            channel_id: user.id,
            status: 'active',
            plan_type: subscriptionTier,
            current_period_start: new Date(),
            current_period_end: endDate,
            stripe_customer_id: 'manual_grant_' + Date.now(),
            stripe_subscription_id: 'manual_grant_' + Date.now(),
        });

        await logAdminAction(req.session.username, req.session.role || 'admin', 'GRANT_SUBSCRIPTION', { targetId: userId, duration, tier: subscriptionTier });
        logger.info(`[Admin] Granted ${duration} days subscription to user ${user.username} (${userId})`);
        
        res.json({ success: true, message: `Granted subscription to ${user.username} for ${duration} days.` });
    } catch (err) {
        logger.error('Error granting subscription:', err);
        res.status(500).json({ error: 'Failed to grant subscription' });
    }
});

/**
 * POST /admin/api/users/:id/revoke-subscription
 * Revoke a user's subscription
 */
router.post('/api/users/:id/revoke-subscription', requireAdminAPI, async (req: any, res: any) => {
    const userId = req.params.id;

    try {
        const user = await Channel.findByPk(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Update user subscription status
        user.has_subscription = false;
        await user.save();

        // Update subscription record
        const { Subscription, CustomBotAccount } = await import('@/db');
        await Subscription.update(
            { status: 'inactive' },
            { where: { channel_id: userId } }
        );

        // Deactivate custom bot if any
        await CustomBotAccount.update(
            { is_active: false },
            { where: { channel_id: userId } }
        );

        await logAdminAction(req.session.username, req.session.role || 'admin', 'REVOKE_SUBSCRIPTION', { targetId: userId });
        logger.info(`[Admin] Revoked subscription from user ${user.username} (${userId})`);

        res.json({ success: true, message: `Revoked subscription from ${user.username}.` });
    } catch (err) {
        logger.error('Error revoking subscription:', err);
        res.status(500).json({ error: 'Failed to revoke subscription' });
    }
});

/**
 * GET /admin/api/subscriptions
 * Get all active subscriptions with details
 */
router.get('/api/subscriptions', requireAdminAPI, async (req: any, res: any) => {
    try {
        const { Subscription, CustomBotAccount } = await import('@/db');

        // Get all users with subscriptions
        const subscribers = await Channel.findAll({
            where: { has_subscription: true },
            attributes: ['id', 'username', 'twitch_user_id', 'has_subscription', 'subscription_tier', 'role'],
        });

        // Get subscription details and custom bot info for each
        const subscriptionData = await Promise.all(subscribers.map(async (sub: any) => {
            const subscription = await Subscription.findOne({
                where: { channel_id: sub.id },
                order: [['created_at', 'DESC']],
            });

            const customBot = await CustomBotAccount.findOne({
                where: { channel_id: sub.id, is_active: true },
            });

            return {
                id: sub.id,
                username: sub.username,
                twitchUserId: sub.twitch_user_id,
                tier: sub.subscription_tier,
                role: sub.role,
                subscription: subscription ? {
                    status: subscription.status,
                    planType: subscription.plan_type,
                    periodStart: subscription.current_period_start,
                    periodEnd: subscription.current_period_end,
                    isManualGrant: subscription.stripe_customer_id?.startsWith('manual_grant_') ||
                                   subscription.stripe_customer_id?.startsWith('test_grant_'),
                } : null,
                customBot: customBot ? {
                    username: customBot.bot_username,
                    isActive: customBot.is_active,
                } : null,
            };
        }));

        res.json({ subscriptions: subscriptionData, total: subscriptionData.length });
    } catch (err) {
        logger.error('Error fetching subscriptions:', err);
        res.status(500).json({ error: 'Failed to fetch subscriptions' });
    }
});

/**
 * GET /admin/api/subscription-stats
 * Get subscription statistics for testing/monitoring
 */
router.get('/api/subscription-stats', requireAdminAPI, async (req: any, res: any) => {
    try {
        const { Subscription, CustomBotAccount } = await import('@/db');
        const { Op } = await import('sequelize');

        const totalSubscribers = await Channel.count({ where: { has_subscription: true } });
        const activeSubscriptions = await Subscription.count({ where: { status: 'active' } });
        const customBotUsers = await CustomBotAccount.count({ where: { is_active: true } });

        // Twitch subscribers (tier 1000, 2000, 3000)
        const twitchSubscribers = await Channel.count({
            where: {
                has_subscription: true,
                subscription_tier: { [Op.in]: ['1000', '2000', '3000'] }
            }
        });

        // Manual grants (not Twitch tier)
        const manualGrants = await Channel.count({
            where: {
                has_subscription: true,
                subscription_tier: { [Op.notIn]: ['1000', '2000', '3000'] }
            }
        });

        // Role-based access (testers, staff, admins without subscription)
        const testerCount = await Channel.count({ where: { role: 'tester', has_subscription: false } });
        const staffCount = await Channel.count({ where: { role: 'Staff', has_subscription: false } });
        const adminCount = await Channel.count({ where: { role: 'admin', has_subscription: false } });

        res.json({
            totalSubscribers,
            twitchSubscribers,
            manualGrants,
            activeSubscriptions,
            customBotUsers,
            roleBypass: {
                testers: testerCount,
                staff: staffCount,
                admins: adminCount,
                total: testerCount + staffCount + adminCount,
            },
            totalPremiumAccess: totalSubscribers + testerCount + staffCount + adminCount,
        });
    } catch (err) {
        logger.error('Error fetching subscription stats:', err);
        res.status(500).json({ error: 'Failed to fetch subscription stats' });
    }
});

/**
 * POST /admin/api/users/:id/set-role
 * Set a user's role (for testing purposes)
 */
router.post('/api/users/:id/set-role', requireAdminAPI, async (req: any, res: any) => {
    const userId = req.params.id;
    const { role } = req.body;

    const validRoles = ['Basic user', 'tester', 'analyst', 'Staff', 'admin'];
    if (!validRoles.includes(role)) {
        return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
    }

    try {
        const user = await Channel.findByPk(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const oldRole = user.role;
        user.role = role;
        await user.save();

        await logAdminAction(req.session.username, req.session.role || 'admin', 'SET_ROLE', {
            targetId: userId,
            oldRole,
            newRole: role
        });
        logger.info(`[Admin] Changed role for ${user.username} from ${oldRole} to ${role}`);

        res.json({ success: true, message: `Changed ${user.username}'s role from ${oldRole} to ${role}.` });
    } catch (err) {
        logger.error('Error setting role:', err);
        res.status(500).json({ error: 'Failed to set role' });
    }
});

/**
 * GET /admin/api/logs
 * Get last 100 lines of main log file
 */
router.get('/api/logs', requireAdminAPI, (req: any, res: any) => {
    // make the log path work regardless of where the server is started from
    const logFilePath = path.join(process.cwd(), 'logs', 'combined.log');
    fs.readFile(logFilePath, 'utf8', (err, data) => {
        if (err) {
            logger.error('Error reading log file:', err);
            return res.status(500).json({ error: 'Failed to read log file' });
        }
        const lines = data.trim().split('\n');
        const last100Lines = lines.slice(-100);

        const entries: any[] = [];
        let currentEntry: any = null;

        last100Lines.forEach(line => {
            // Expected format: TIMESTAMP [LEVEL]: MESSAGE
            const match = line.match(/^(\S+) \[(\w+)\]: (.*)$/);
            if (match) {
                if (currentEntry) entries.push(currentEntry);
                currentEntry = {
                    timestamp: match[1],
                    level: match[2].toLowerCase(),
                    message: match[3]
                };
            } else {
                if (currentEntry) {
                    currentEntry.message += '\n' + line;
                } else {
                    // Orphan line or non-standard format
                    entries.push({
                        timestamp: new Date().toISOString(),
                        level: 'info',
                        message: line
                    });
                }
            }
        });
        if (currentEntry) entries.push(currentEntry);

        res.json({ entries });
    });
});

/**
 * GET /admin/api/commands
 * List all custom commands across all users
 */
router.get('/api/commands', requireAdminAPI, async (req: any, res: any) => {
    try {
        const { CustomResponse } = await import('@/db');
        const commands = await CustomResponse.findAll({
            attributes: ['channel', 'command', 'response']
        });

        const formatted = commands.map((c: any) => ({
            channel: c.channel,
            command: c.command,
            response: c.response
        }));

        res.json({ commands: formatted });
    } catch (err) {
        logger.error('Error fetching all custom commands:', err);
        res.status(500).json({ error: 'Failed to fetch commands.' });
    }
});

/**
 * GET /admin/api/performance
 * Get performance metrics
 */
router.get('/api/performance', requireStaffAPI, (req: any, res: any) => {
    const metrics = performanceMonitor.getMetrics();
    res.json(metrics);
});

/**
 * POST /admin/api/message
 * Send custom message to bot
 */
router.post("/api/message", requireApiKey, async (req: any, res: any) => {
    try {
        const { channel, message } = req.body;

        if (!message || typeof message !== "string") {
            return res.status(400).json({ error: "Message is required" });
        }

        // Forward request to bot process
        await axios.post("http://localhost:4000/send-message", {
            channel,
            message,
        });

        logger.info(`[Admin] Sent message "${message}" to ${channel || "all channels"}`);
        res.json({ success: true });
    } catch (err) {
        logger.error("Error sending custom message:", err);
        res.status(500).json({ error: "Failed to send message" });
    }
});

/**
 * POST /admin/api/refresh-bot-token
 * Refresh bot access token and reconnect all channels
 */
router.post('/api/refresh-bot-token', csrfProtection, requireAdminAPI, async (req: any, res: any) => {
    try {
        const result = await refreshBotToken();

        // Auto-reconnect IRC bot for all connected channels so new token is used
        const commandHandler = loadCommands();
        const usernames = Object.keys(clients);

        // Stagger reconnects to avoid reconnect storms
        const delayPer = 200;
        const reconnectPromises = usernames.map((uname, i) => new Promise<void>(resolve => {
            setTimeout(async () => {
                try {
                    await reconnectChatBot(uname, commandHandler);
                } catch (e) {
                    logger.warn(`Failed to reconnect IRC bot for ${uname}:`, e);
                } finally {
                    resolve();
                }
            }, i * delayPer + Math.floor(Math.random() * 100));
        }));

        await Promise.allSettled(reconnectPromises);

        await logAdminAction(req.session.username, req.session.role || 'admin', 'REFRESH_BOT_TOKEN');
        res.json({
            ok: true,
            accessTokenPreview: result.accessToken.slice(0, 6) + "…",
            refreshTokenPreview: result.refreshToken.slice(0, 6) + "…",
            expiresIn: result.expiresIn,
        });
    } catch (err: any) {
        res.status(500).json({ ok: false, error: err?.message || 'Failed to refresh bot token' });
    }
});

/**
 * POST /admin/api/restart-bot
 * Restart bot process via PM2
 */
router.post("/api/restart-bot", requireApiKey, async (req: any, res: any) => {
    try {
        exec("pm2 restart FinalsRS-bot", async (err, stdout, stderr) => {
            if (err) {
                logger.error("Failed to restart bot via admin API:", err);
                return res.status(500).json({ success: false, error: "Failed to restart bot" });
            }
            await logAdminAction(req.session?.username || 'API_USER', req.session?.role || 'admin', 'RESTART_BOT');
            logger.info(`[Admin] Restarted bot via API. Output: ${stdout}`);
            res.json({ success: true });
        });
    } catch (err) {
        logger.error("Unexpected error in restart-bot endpoint:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * POST /admin/api/deploy
 * Trigger the deployment script
 */
router.post("/api/deploy", requireApiKey, async (req, res) => {
  try {
    // SECURITY: Require DEPLOY_SECRET to be set - no fallback
    const deploySecret = process.env.DEPLOY_SECRET;
    if (!deploySecret) {
      logger.error('[Deploy] DEPLOY_SECRET not configured');
      return res.status(500).json({ error: 'Deploy secret not configured' });
    }

    const response = await axios.post("http://127.0.0.1:2500/deploy", {}, {
      headers: { "x-deploy-token": deploySecret }
    });

    await logAdminAction((req.session as any)?.username || 'API_USER', (req.session as any)?.role || 'admin', 'TRIGGER_DEPLOY');
    res.json({ success: true, message: "Deployment triggered" });
  } catch (err: any) {
    console.error("Deploy trigger failed:", err.response?.data || err.message || err);
    res.status(500).json({ error: "Failed to trigger deployment", details: err.message });
  }
});


/**
 * POST /admin/api/pause-bot
 * Pause bot (stub endpoint)
 */
router.post('/api/pause-bot', requireApiKey, async (req: any, res: any) => {
    // TODO: Implement actual pause logic
    await logAdminAction(req.session?.username || 'API_USER', req.session?.role || 'admin', 'PAUSE_BOT');
    logger.info("[Admin] Bot pause requested.");
    res.json({ success: true, message: "Bot pause requested (not yet implemented)." });
});

/**
 * POST /admin/api/resume-bot
 * Resume bot (stub endpoint)
 */
router.post('/api/resume-bot', requireApiKey, async (req: any, res: any) => {
    // TODO: Implement actual resume logic
    await logAdminAction(req.session?.username || 'API_USER', req.session?.role || 'admin', 'RESUME_BOT');
    logger.info("[Admin] Bot resume requested.");
    res.json({ success: true, message: "Bot resume requested (not yet implemented)." });
});

/**
 * GET /admin/api/user-dashboard-access
 * Get user dashboard access status
 */
router.get('/api/user-dashboard-access', requireAdminAPI, (req: any, res: any) => {
    res.json({ enabled: isDashboardEnabled() });
});

/**
 * POST /admin/api/user-dashboard-access
 * Set user dashboard access status
 */
router.post('/api/user-dashboard-access', requireAdminAPI, (req: any, res: any) => {
    const { enabled } = req.body;

    if (typeof enabled !== "boolean") {
        return res.status(400).json({ error: "Missing or invalid 'enabled' field" });
    }

    setDashboardEnabled(enabled);
    logger.info(`[Admin] Set user dashboard access to: ${enabled}`);
    res.json({ success: true, enabled });
});

/**
 * GET /admin/api/drops
 * Get drops configuration
 */
router.get('/api/drops', requireStaffAPI, (req: any, res: any) => {
    const dropsPath = path.join(process.cwd(), 'frontend', 'public', 'drops.json');
    fs.readFile(dropsPath, 'utf8', (err, data) => {
        if (err) {
            logger.error('Error reading drops file:', err);
            return res.status(500).json({ error: 'Failed to read drops config' });
        }
        try {
            res.json(JSON.parse(data));
        } catch (e) {
            res.status(500).json({ error: 'Invalid JSON in drops config' });
        }
    });
});

/**
 * POST /admin/api/drops
 * Update drops configuration
 */
router.post('/api/drops', requireStaffAPI, async (req: any, res: any) => {
    const dropsPath = path.join(process.cwd(), 'frontend', 'public', 'drops.json');
    const newConfig = req.body;

    if (!newConfig || !Array.isArray(newConfig.drops)) {
        return res.status(400).json({ error: 'Invalid drops configuration' });
    }

    fs.writeFile(dropsPath, JSON.stringify(newConfig, null, 2), async (err) => {
        if (err) {
            logger.error('Error writing drops file:', err);
            return res.status(500).json({ error: 'Failed to save drops config' });
        }
        await logAdminAction(req.session.username, req.session.role || (isAdmin(req) ? 'admin' : 'Staff'), 'UPDATE_DROPS', newConfig);
        logger.info(`[Admin] Updated drops configuration`);
        res.json({ success: true });
    });
});

/**
 * POST /admin/api/upload
 * Upload an image for drops
 */
router.post('/api/upload', requireStaffAPI, upload.single('image'), async (req: any, res: any) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    const fileUrl = `/uploads/${req.file.filename}`;
    await logAdminAction(req.session.username, req.session.role || (isAdmin(req) ? 'admin' : 'Staff'), 'UPLOAD_IMAGE', { filename: req.file.filename, url: fileUrl });
    res.json({ success: true, url: fileUrl });
});

/**
 * GET /admin/api/analytics
 * Get global command analytics
 */
router.get('/api/analytics', requireStaffAPI, async (req: any, res: any) => {
    try {
        // Parse query parameters
        const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
        const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
        const command = req.query.command as string | undefined;
        const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;

        // Get analytics (no channel specified = global)
        const analytics = await getCommandAnalytics(null as any, {
            startDate,
            endDate,
            command,
            limit,
        });

        res.json(analytics);
    } catch (err) {
        logger.error('Error fetching global analytics:', err);
        res.status(500).json({ error: 'Failed to fetch global analytics.' });
    }
});

/**
 * GET /admin/api/statistics
 * Get combined statistics data (web requests + command usage + IGN analytics)
 * Accessible to analysts and admins
 */
router.get('/api/statistics', async (req: any, res: any) => {
    // Import the requireAnalyst middleware
    const { requireAnalyst } = await import('@/middleware/auth.middleware');
    
    // Check if user has analyst or admin role
    await requireAnalyst(req, res, async () => {
        try {
            const { getAnalytics } = await import('@/util/webAnalytics');
            const { getIGNStats } = await import('@/util/ignStats');
            const { RequestMetric } = await import('@/dbMetrics');
            const { Op } = await import('sequelize');

            // Get time ranges
            const now = new Date();
            const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

            // Get web analytics
            const webAnalytics = await getAnalytics();

            // Get IGN stats
            const ignStats = await getIGNStats();

            // Get command analytics
            const commandAnalytics = await getCommandAnalytics(null as any, {
                startDate: last30d,
                limit: 100
            });

            // Get request metrics by endpoint (top 20)
            const requestsByEndpoint = await RequestMetric.findAll({
                attributes: [
                    'endpoint',
                    [RequestMetric.sequelize!.fn('COUNT', RequestMetric.sequelize!.col('id')), 'count'],
                    [RequestMetric.sequelize!.fn('AVG', RequestMetric.sequelize!.col('responseTimeMs')), 'avgResponseTime']
                ],
                where: {
                    timestamp: { [Op.gte]: last7d }
                },
                group: ['endpoint'],
                order: [['count', 'DESC']] as any,
                limit: 20,
                raw: true
            });

            // Get requests by status code
            const requestsByStatus = await RequestMetric.findAll({
                attributes: [
                    'statusCode',
                    [RequestMetric.sequelize!.fn('COUNT', RequestMetric.sequelize!.col('id')), 'count']
                ],
                where: {
                    timestamp: { [Op.gte]: last7d }
                },
                group: ['statusCode'],
                order: [['count', 'DESC']] as any,
                raw: true
            });

            // Get hourly request distribution for last 24h
            const hourlyRequests = await RequestMetric.findAll({
                attributes: [
                    [RequestMetric.sequelize!.fn('strftime', '%H', RequestMetric.sequelize!.col('timestamp')), 'hour'],
                    [RequestMetric.sequelize!.fn('COUNT', RequestMetric.sequelize!.col('id')), 'count']
                ],
                where: {
                    timestamp: { [Op.gte]: last24h }
                },
                group: ['hour'] as any,
                order: [['hour', 'ASC']] as any,
                raw: true
            });

            res.json({
                webAnalytics,
                ignStats,
                commandAnalytics,
                requestMetrics: {
                    byEndpoint: requestsByEndpoint,
                    byStatus: requestsByStatus,
                    hourlyDistribution: hourlyRequests
                },
                timestamp: now.toISOString()
            });
        } catch (err) {
            logger.error('Error fetching combined statistics:', err);
            res.status(500).json({ error: 'Failed to fetch statistics.' });
        }
    });
});

/**
 * GET /admin/api/feedback
 * List recent user feedback
 */
router.get('/api/feedback', requireStaffAPI, async (req: any, res: any) => {
    try {
        const { Feedback } = await import('@/db');
        const feedback = await Feedback.findAll({
            order: [['created_at', 'DESC']],
            limit: 100
        });
        res.json({ feedback });
    } catch (err) {
        logger.error('Error fetching feedback:', err);
        res.status(500).json({ error: 'Failed to fetch feedback' });
    }
});

/**
 * DELETE /admin/api/feedback/:id
 * Delete a feedback entry
 */
router.delete('/api/feedback/:id', requireAdminAPI, async (req: any, res: any) => {
    try {
        const { Feedback } = await import('@/db');
        const deleted = await Feedback.destroy({ where: { id: req.params.id } });
        if (deleted) {
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Feedback not found' });
        }
    } catch (err) {
        logger.error('Error deleting feedback:', err);
        res.status(500).json({ error: 'Failed to delete feedback' });
    }
});

export default router;