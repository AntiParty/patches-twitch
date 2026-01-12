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
import { reconnectChatBot, clients } from '@/util/ircBot';
import { loadCommands } from '@/handlers/commands';
import { getCommandAnalytics } from '@/util/commandAnalytics';
import multer from 'multer';
import { requireAdminAPI, isAdmin, isStaff, requireApiKey, requireStaff, requireStaffAPI } from '@/middleware/auth.middleware';
import { csrfProtection } from '@/middleware/csrf.middleware';
import { isDashboardEnabled, setDashboardEnabled } from '@/routes/user/dashboard.routes';
import { logAdminAction } from '@/util/adminLogger';

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
 */
router.get('/', csrfProtection, requireStaff, (req: any, res: any) => {
    const viewsPath = path.join(process.cwd(), 'frontend', 'views');
    res.sendFile(path.join(viewsPath, 'admin-dashboard.html'));
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
            attributes: ['id', 'username', 'role', 'twitch_user_id']
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
    const validRoles = ['Basic user', 'tester', 'Staff', 'admin'];

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
    const deploySecret = process.env.DEPLOY_SECRET || "supersecret";
    
    const response = await axios.post("http://127.0.0.1:2500/deploy", {}, {
      headers: { "x-deploy-token": "supersecret" }
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

export default router;