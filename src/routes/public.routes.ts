/**
 * Public Routes
 * Handles publicly accessible pages and API endpoints
 */
import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { Channel } from '@/db';
import logger from '@/util/logger';
import { sendMessageToDiscord } from '@/handlers/discordHandler';
import { requireApiKey } from '@/middleware/auth.middleware';
import { getAnalytics } from '@/util/webAnalytics';

const router = Router();

// Path to frontend assets
const frontendPath = path.join(process.cwd(), "frontend");
const statsFilePath = path.join(process.cwd(), "stats.json");

// Track server start time for uptime calculation
const serverStartTime = Date.now();

/**
 * GET /health
 * Returns health status of the server and database
 */
router.get("/health", async (req: Request, res: Response) => {
    const checks: Array<any> = [];

    // Record a check outcome
    function recordCheck(
        name: string,
        status: "ok" | "error" | "optional",
        latencyMs: number | null = null,
        detail: string | null = null
    ) {
        checks.push({ name, status, latencyMs, detail });
    }

    // Track health state globally for alert transitions
    globalThis.__healthState = globalThis.__healthState || {};

    // --- DATABASE CHECK ---
    let dbHealthy = false;
    let dbLatency: number | null = null;

    try {
        const dbStart = Date.now();

        // Authenticate (timeout-protected)
        await Promise.race([
            (Channel.sequelize as any).authenticate(),
            new Promise((_, rej) => setTimeout(() => rej(new Error("DB auth timeout")), 2000)),
        ]);

        // Quick SELECT 1 test
        await Promise.race([
            (Channel.sequelize as any).query("SELECT 1"),
            new Promise((_, rej) => setTimeout(() => rej(new Error("DB query timeout")), 2000)),
        ]);

        dbLatency = Date.now() - dbStart;
        dbHealthy = true;
        recordCheck("database", "ok", dbLatency, "connected");
    } catch (error: any) {
        recordCheck(
            "database",
            "error",
            dbLatency,
            error?.message ?? String(error)
        );

        // Alert DB down only once (transition → unhealthy)
        if (!globalThis.__healthState.dbDown) {
            try {
                sendMessageToDiscord("⚠️ Critical: Database connection failed during health check.");
            } catch { }
            globalThis.__healthState.dbDown = true;
            globalThis.__healthState.dbDownSince = Date.now();
        }
    }

    // DB recovered: send recovery message once
    if (dbHealthy && globalThis.__healthState.dbDown) {
        try {
            sendMessageToDiscord("✅ Notice: Database connection restored.");
        } catch { }
        globalThis.__healthState.dbDown = false;
        globalThis.__healthState.dbRecoveredAt = Date.now();
    }

    // --- BOT CHECK (optional by default) ---
    const strictBotCheck = process.env.HEALTH_CHECK_BOT_STRICT === "true";
    const botCheckEnabled = process.env.HEALTH_CHECK_BOT !== "false";

    let botHealthy = null;
    let botLatency = null;

    if (botCheckEnabled) {
        try {
            const botStart = Date.now();
            await axios.get("http://localhost:4000/health", { timeout: 1500 });
            botLatency = Date.now() - botStart;
            botHealthy = true;

            recordCheck("bot", strictBotCheck ? "ok" : "optional", botLatency, "responding");
        } catch (err: any) {
            botHealthy = false;

            recordCheck(
                "bot",
                strictBotCheck ? "error" : "optional",
                botLatency,
                err?.code || err?.message || "bot unreachable"
            );
        }
    }

    // --- RUNTIME METRICS ---
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const uptime = process.uptime();
    const timestamp = Date.now();
    const { version } = require("../../package.json");

    // --- OVERALL HEALTH ---
    const overallOk =
        dbHealthy &&
        (strictBotCheck
            ? botHealthy === true
            : true); // bot does NOT decide overall health unless strict mode is on

    res.status(overallOk ? 200 : 500).json({
        status: overallOk ? "ok" : "error",
        version,
        timestamp,
        uptime,
        checks,
        memory: {
            rss: memoryUsage.rss,
            heapUsed: memoryUsage.heapUsed,
            heapTotal: memoryUsage.heapTotal,
        },
        cpu: {
            user: cpuUsage.user,
            system: cpuUsage.system,
        },
    });
});

/**
 * GET /docs
 * Serve HTML docs page
 */
router.get('/docs', (req: Request, res: Response) => {
    res.sendFile(path.join(frontendPath, 'docs.html'));
});

/**
 * GET /docs-markdown
 * Serve markdown documentation
 */
router.get('/docs-markdown', (req: Request, res: Response) => {
    const docsPath = path.join(process.cwd(), 'docs', 'custom-command-editing.md');
    fs.readFile(docsPath, 'utf8', (err, data) => {
        if (err) return res.status(404).send('Docs not found');
        res.type('text/plain').send(data);
    });
});

/**
 * GET /legal
 * Serve legal page (privacy policy, ToS)
 */
router.get('/legal', (req: Request, res: Response) => {
    res.sendFile(path.join(frontendPath, 'legal.html'));
});

/**
 * GET /twitch-drops
 * Serve Twitch drops information page
 */
router.get('/twitch-drops', (req: Request, res: Response) => {
    res.sendFile(path.join(frontendPath, 'drops.html'));
});

/**
 * GET /sitemap.xml
 * Serve sitemap for SEO
 */
router.get('/sitemap.xml', (req: Request, res: Response) => {
    res.sendFile(path.join(process.cwd(), 'frontend', 'sitemap.xml'));
});

/**
 * GET /stats.json
 * Serve current stats as JSON
 */
router.get("/stats.json", (req: Request, res: Response) => {
    fs.readFile(statsFilePath, "utf8", (err, data) => {
        if (err) return res.status(500).json({ error: "Stats not available" });
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", "*"); // Allow browsers
        res.send(data);
    });
});

/**
 * GET /force-stats
 * Force update and return latest stats
 */
router.get("/force-stats", async (req: Request, res: Response) => {
    try {
        const userCount = await Channel.count();
        const uptime = Math.floor((Date.now() - serverStartTime) / 1000);

        // Import these functions dynamically to avoid circular dependencies
        const { getCommandsProcessed } = await import('@/server');

        const stats = {
            userCount,
            commandsProcessed: getCommandsProcessed(),
            uptime
        };

        // Update stats.json immediately
        fs.writeFile(statsFilePath, JSON.stringify(stats, null, 2), err => {
            if (err) logger.error("Failed to write stats.json:", err);
        });

        res.status(200).json(stats);
    } catch (err) {
        logger.error("Error in /force-stats:", err);
        res.status(500).json({ error: "Failed to fetch stats" });
    }
});

/**
 * GET /users
 * List all users/channels (protected by API key)
 */
router.get("/users", requireApiKey, async (req: Request, res: Response) => {
    try {
        const channels = await Channel.findAll({ attributes: ['username'] });
        const usernames = channels.map((c: any) => c.username);
        res.status(200).json({ userCount: usernames.length, channels: usernames });
    } catch (error) {
        logger.error("Error fetching users:", error);
        res.status(500).json({ error: "Failed to fetch users" });
    }
});

/**
 * get analytics data
 * Returns aggregated web analytics including historical and today's data.
 * Combines data from AnalyticsDay and RequestMetric tables.
 * 
 */

router.get('/api/analytics', async (req: any, res: any) => {
    try {
        const analytics = await getAnalytics();
        res.json(analytics);
        
    } catch (err) {
        logger.error('Error fetching analytics:', err);
        res.status(500).json({ error: 'Failed to fetch analytics.' });
    }
});

// test route to verify if Ruby is unlocked/available
// only a GET request
router.get('/api/ruby-status', async (req: any, res: any) => {
    try {
        const { getRubyRankThreshold } = await import('@/jobs/cacheUpdater');
        const threshold = await getRubyRankThreshold();
        // 
        if (threshold?.league === 'Ruby') {
            return res.json({ rubyAvailable: true, message: 'Ruby league is available!' });
        } else {
            return res.json({ rubyAvailable: false, message: 'Ruby league is not yet available.' });
        }
    } catch (err) {
        logger.error('Error testing Ruby availability:', err);
        return res.status(500).json({ error: 'Failed to test Ruby availability.' });
    }
})

router.get('/api/ign-stats', async (req: any, res: any) => {
    try {
        const { getIGNStats } = await import('@/util/ignStats');
        const ignStats = await getIGNStats();
        res.json(ignStats);
    } catch (err) {
        logger.error('Error fetching IGN stats:', err);
        res.status(500).json({ error: 'Failed to fetch IGN stats.' });
    }
})

//analytics dashboard for youtube video expirement
router.get('/analytics-dashboard', (req: Request, res: Response) => {
    res.sendFile(path.join(frontendPath, 'analytics-dashboard.html'));
})

export default router;