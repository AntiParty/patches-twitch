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
import { log } from 'console';

const router = Router();

// Path to frontend assets and templates
const viewsPath = path.join(process.cwd(), "frontend", "views");
const publicPath = path.join(process.cwd(), "frontend", "public");
const statsFilePath = path.join(process.cwd(), "stats.json");



// Track server start time for uptime calculation
const serverStartTime = Date.now();

router.get("/", (req: Request, res: Response) => {
    res.sendFile(path.join(viewsPath, "index.html"));
}); 

router.get("/banned", (req: any, res: Response) => {
    const reason = req.session?.banReason || "No reason provided.";
    res.render("banned", { reason });
}); 


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
    res.sendFile(path.join(viewsPath, 'docs.html'));
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

router.get("/privacy.md", (req: Request, res: Response) => {
  res.sendFile(path.join(viewsPath, "privacy.md"));
});

/**
 * GET /terms.md
 * Serve terms of service markdown
 */
router.get("/terms.md", (req: Request, res: Response) => {
  res.sendFile(path.join(viewsPath, "terms.md"));
});

/**
 * GET /legal
 * Serve legal page (privacy policy, ToS)
 */
router.get('/legal', (req: Request, res: Response) => {
    res.sendFile(path.join(viewsPath, 'legal.html'));
});

/**
 * GET /twitch-drops
 * Serve Twitch drops information page
 */
router.get('/twitch-drops', (req: Request, res: Response) => {
    res.sendFile(path.join(viewsPath, 'drops.html'));
});

router.get('/drops', (req: Request, res: Response) => {
    res.redirect('/twitch-drops');
});

function getcacheDir() {
    return path.resolve(__dirname, "../../cache");
    //log the path
    logger.info(`Cache directory path: ${path.resolve(__dirname, "../../cache")}`);
};

// test api router for twitch bot integrations (api)
// grab user input from query params
// example: /test-api?user=carnifex&tag=7330
//make the user take in a name and # tags so example carnifex#7330
router.get('/test-api', (req: Request, res: Response) => {
    //take in details such as name: carnifex, tag: 7330
    const user = req.query.user as string;
    const tags = req.query.tag as string;
    // combine user and tag
    const userAndTag = `${user}#${tags}`;
    logger.info(`Received test-api request for user: ${userAndTag}`);
    
    const cacheFilePath = path.join(getcacheDir(), 'regular_s9.json');
    fs.readFile(cacheFilePath, 'utf8', (err, data) => {
        if (err) {
            logger.error(`Error reading cache file: ${err}`);
            return res.status(500).json({ error: 'Failed to read cache file' });
        }

        try {
                    const leaderboard = JSON.parse(data);
                    const userEntry = leaderboard.find((entry: any) => entry.name.toLowerCase() === userAndTag.toLowerCase());
                    if (userEntry) {
                        logger.info(`Found user entry for ${userAndTag}: ${JSON.stringify(userEntry)}`);

                        // format the response (not into json)
                        return res.status(200).send(`${userEntry.name} is Currently \nRank: ${userEntry.league}\n: ${userEntry.rankScore}RS `)
                    } else {
                        logger.info(`User ${userAndTag} not found in leaderboard.`);
                        return res.status(404).json({
                            error: 'User not found in leaderboard'
                        });
                    }
                } catch (parseErr) {
                    logger.error(`Error parsing cache file: ${parseErr}`);
                    return res.status(500).json({
                        error: 'Failed to parse cache file'
                    });
                }
    })

});
// example endpoint: /test-api?user=testuser&message=!hello

/**
 * GET /sitemap.xml
 * Serve sitemap for SEO
 */
router.get('/sitemap.xml', (req: Request, res: Response) => {
    res.sendFile(path.join(publicPath, 'sitemap.xml'));
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

// RS Prediction API
router.get('/api/rs-prediction', async (req: Request, res: Response) => {
    try {
        const { getRSPrediction } = await import('@/util/rsPredictor');
        
        let days = 61;
        if (req.query.days) {
            const parsed = parseInt(req.query.days as string, 10);
            if (!isNaN(parsed) && parsed > 0) {
                days = parsed;
            }
        }

        const prediction = await getRSPrediction(days);
        
        if (!prediction) {
             res.status(200).json({ 
                 status: "pending",
                 message: "Not enough data for prediction.",
                 confidence: "None"
             });
             return;
        }

        res.json({
            currentRS: prediction.currentRS,
            dailyChange: prediction.dailyChange,
            safeRS: prediction.safeRS,
            safeRS_min: prediction.safeRS_min,
            safeRS_max: prediction.safeRS_max,
            remainingDays: prediction.remainingDays,
            dataPointsUsed: prediction.dataPointsUsed,
            confidence: prediction.confidence,
            standardError: prediction.standardError
        });

    } catch (err) {
        logger.error('Error fetching RS prediction:', err);
        res.status(500).json({ error: 'Failed to generate RS prediction.' });
    }
});

//analytics dashboard for youtube video expirement
router.get('/analytics-dashboard', (req: Request, res: Response) => {
    res.sendFile(path.join(viewsPath, 'analytics-dashboard.html'));
})

export default router;