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
import { requireAdminAPI, isAdmin, requireApiKey } from '@/middleware/auth.middleware';
import { csrfProtection } from '@/middleware/csrf.middleware';
import { isDashboardEnabled, setDashboardEnabled } from '@/routes/user/dashboard.routes';
import { sendWarningToDiscord } from '@/handlers/discordHandler';

const router = Router();

// Track server start time for uptime calculation
const serverStartTime = Date.now();

/**
 * GET /admin
 * Render admin dashboard page
 */
router.get('/', csrfProtection, (req: any, res: any) => {
    if (!isAdmin(req)) {
        return res.redirect('/admin/login');
    }
    const frontendPath = path.join(process.cwd(), 'frontend');
    res.sendFile(path.join(frontendPath, 'admin-dashboard.html'));
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
router.get('/api/stats', requireAdminAPI, async (req: any, res: any) => {
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
        const channels = await Channel.findAll({ attributes: ['username'] });
        const usernames = channels.map((c: any) => c.username);
        res.status(200).json({ userCount: usernames.length, channels: usernames });
    } catch (err) {
        logger.error("Error fetching channels list:", err);
        res.status(500).json({ error: "Failed to fetch channels" });
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
router.get('/api/performance', requireAdminAPI, (req: any, res: any) => {
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
        exec("pm2 restart FinalsRS-bot", (err, stdout, stderr) => {
            if (err) {
                logger.error("Failed to restart bot via admin API:", err);
                return res.status(500).json({ success: false, error: "Failed to restart bot" });
            }
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
router.post("/api/deploy", requireApiKey, async (req: any, res: any) => {
    try {
        const deployScriptPath = path.join(process.cwd(), "deploy.sh");

        logger.info(`[Admin] Triggering deployment script at ${deployScriptPath}`);

        // Always use bash on your Linux server
        const shell = "/bin/bash";

        logger.info(`[Admin] Using shell: ${shell}`);

        const cmd = `${shell} "${deployScriptPath}"`;
        logger.info(`[Admin] Executing command: ${cmd}`);

        const deployProcess = exec(
            cmd,
            {
                cwd: process.cwd(),
                env: { 
                    ...process.env, 
                    PATH: "/usr/bin:/bin:/usr/local/bin:/usr/sbin:/sbin" 
                }
            },
            (err, stdout, stderr) => {
                if (stdout) logger.info(`[Deploy stdout]:\n${stdout}`);
                if (stderr) logger.error(`[Deploy stderr]:\n${stderr}`);
                if (err) logger.error("[Deploy Error]:", err);
            }
        );

        res.json({
            success: true,
            message: "Deployment started. The server will backup and restart shortly."
        });

        sendWarningToDiscord("Deployment started. The server will backup and restart shortly.");

    } catch (err) {
        logger.error("Error triggering deployment:", err);
        res.status(500).json({ error: "Failed to trigger deployment" });
    }
});

/**
 * POST /admin/api/pause-bot
 * Pause bot (stub endpoint)
 */
router.post('/api/pause-bot', requireApiKey, (req: any, res: any) => {
    // TODO: Implement actual pause logic
    logger.info("[Admin] Bot pause requested.");
    res.json({ success: true, message: "Bot pause requested (not yet implemented)." });
});

/**
 * POST /admin/api/resume-bot
 * Resume bot (stub endpoint)
 */
router.post('/api/resume-bot', requireApiKey, (req: any, res: any) => {
    // TODO: Implement actual resume logic
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

export default router;