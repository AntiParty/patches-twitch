/**
 * Public Routes
 * Handles publicly accessible pages and API endpoints
 */
import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { Channel, CommandUsage, StreamSession } from '@/db';
import { PerformanceMetric } from '@/dbMetrics';
import { Referral } from '@/dbMetrics';
import logger from '@/util/logger';
import { sendMessageToDiscord } from '@/handlers/discordHandler';
import { requireApiKey } from '@/middleware/auth.middleware';
import { rateLimitFeedback } from '@/middleware/security';
import { getAnalytics } from '@/util/webAnalytics';
import { log } from 'console';

const router = Router();

// Path to frontend assets and templates
const viewsPath = path.join(process.cwd(), "frontend", "views");
const publicPath = path.join(process.cwd(), "frontend", "public");
const statsFilePath = path.join(process.cwd(), "stats.json");



// Track server start time for uptime calculation
const serverStartTime = Date.now();

router.get("/", async (req: Request, res: Response) => {
    const ref = req.query.ref as string;
    if (ref) {
        try {
            await Referral.create({ source: ref });
            logger.info(`Tracked referral from: ${ref}`);
        } catch (err) {
            logger.error("Failed to track referral:", err);
        }
    }
    res.sendFile(path.join(viewsPath, "index.html"));
});

router.get("/banned", (req: any, res: Response) => {
    const reason = req.session?.banReason || "No reason provided.";
    res.render("banned", { reason });
}); 

/**
 * GET /analyst
 * Redirect to analyst statistics dashboard
 */
router.get("/analyst", (req: Request, res: Response) => {
    res.redirect('/statistics');
});

/**
 * GET /statistics/login
 * Render statistics login page
 */
router.get("/statistics/login", (req: any, res: Response) => {
    const csrfToken = req.csrfToken ? req.csrfToken() : '';
    res.send(`<!DOCTYPE html><html><head><title>Statistics Login</title><style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#111;color:#eee}form{background:#222;padding:2rem;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.5)}input{display:block;margin-bottom:1rem;padding:0.5rem;width:200px;border-radius:4px;border:1px solid #444;background:#111;color:#fff}button{width:100%;padding:0.5rem;border:none;border-radius:4px;background:#3b82f6;color:#fff;cursor:pointer}button:hover{background:#2563eb}</style></head><body><form method="POST" action="/statistics/login"><h2 style="margin-top:0">Statistics Login</h2><input name="username" placeholder="Username" required><br><input name="password" type="password" placeholder="Password" required><br><input type="hidden" name="_csrf" value="${csrfToken}"><button type="submit">Login</button></form></body></html>`);
});

/**
 * POST /statistics/login
 * Handle statistics login
 */
router.post("/statistics/login", async (req: any, res: Response) => {
    const { username, password } = req.body;
    const { verifySimpleLogin } = await import('@/util/simpleUsers');

    const user = await verifySimpleLogin(username, password);

    if (user) {
        req.session.username = user.username;
        req.session.role = user.role;
        // Also set isAdmin if role is admin, though simple users usually are analysts
        if (user.role === 'admin') req.session.isAdmin = true;
        
        logger.info(`[Auth] Simple user ${username} logged in as ${user.role}`);
        return res.redirect('/statistics');
    }

    logger.warn(`[Auth] Failed login attempt for ${username}`);
    res.redirect('/statistics/login?error=invalid');
});

/**
 * GET /statistics
 * Statistics dashboard (requires analyst or admin role)
 */
router.get("/statistics", async (req: any, res: Response) => {
    const { requireAnalyst } = await import('@/middleware/auth.middleware');
    await requireAnalyst(req, res, () => {
        const csrfToken = req.csrfToken ? req.csrfToken() : '';
        res.render('statistics-dashboard', { csrfToken });
    });
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
 * GET /developer
 * Serve HTML Developer API page
 */
router.get('/developer', (req: Request, res: Response) => {
    res.sendFile(path.join(viewsPath, 'developer-api.html'));
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

/**
 * GET /api/statistics
 * Get combined statistics data (web requests + command usage + IGN analytics)
 * Accessible to analysts and admins
 */
router.get('/api/statistics', async (req: any, res: any) => {
    const { requireAnalystAPI } = await import('@/middleware/auth.middleware');
    
    // Check if user has analyst or admin role
    await requireAnalystAPI(req, res, async () => {
        try {
            const { getAnalytics } = await import('@/util/webAnalytics');
            const { getIGNStats } = await import('@/util/ignStats');
            const { getCommandAnalytics } = await import('@/util/commandAnalytics');
            const { RequestMetric } = await import('@/dbMetrics');
            const { Op } = await import('sequelize');

            // Get time ranges
            const now = new Date();
            const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

            // Execute all major data fetches in parallel
            const [
                webAnalytics,
                ignStats,
                commandAnalytics,
                requestsByEndpoint,
                requestsByStatus,
                hourlyRequests,
                referrals,
                performanceHistory
            ] = await Promise.all([
                // 1. Web Analytics
                getAnalytics(),

                // 2. IGN Stats
                getIGNStats(),

                // 3. Command Analytics
                getCommandAnalytics(null as any, {
                    startDate: last30d,
                    limit: 100
                }),

                // 4. Request Metrics by Endpoint
                RequestMetric.findAll({
                    attributes: [
                        'endpoint',
                        [RequestMetric.sequelize!.fn('COUNT', RequestMetric.sequelize!.col('id')), 'count'],
                        [RequestMetric.sequelize!.fn('AVG', RequestMetric.sequelize!.col('responseTimeMs')), 'avgResponseTime']
                    ],
                    where: {
                        timestamp: { [Op.gte]: last30d }
                    },
                    group: ['endpoint'],
                    order: [['count', 'DESC']] as any,
                    limit: 20,
                    raw: true
                }),

                // 5. Request Metrics by Status
                RequestMetric.findAll({
                    attributes: [
                        'statusCode',
                        [RequestMetric.sequelize!.fn('COUNT', RequestMetric.sequelize!.col('id')), 'count']
                    ],
                    where: {
                        timestamp: { [Op.gte]: last30d }
                    },
                    group: ['statusCode'],
                    order: [['count', 'DESC']] as any,
                    raw: true
                }),

                // 6. Hourly Requests
                RequestMetric.findAll({
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
                }),

                // 7. Referrals
                (async () => {
                    const { Referral } = await import('@/dbMetrics');
                    return Referral.findAll({
                        attributes: [
                            'source',
                            [Referral.sequelize!.fn('COUNT', Referral.sequelize!.col('id')), 'count']
                        ],
                        where: {
                            timestamp: { [Op.gte]: last30d }
                        },
                        group: ['source'],
                        order: [['count', 'DESC']] as any,
                        limit: 50,
                        raw: true
                    });
                })(),

                // 8. Performance History
                (async () => {
                   const { PerformanceMetric } = await import('@/dbMetrics');
                   return PerformanceMetric.findAll({
                        attributes: ['timestamp', 'cpuUsage', 'memoryUsed', 'botLatencyMs', 'connectedChannels'],
                        where: {
                            timestamp: { [Op.gte]: last24h }
                        },
                        order: [['timestamp', 'ASC']],
                        raw: true
                    });
                })()
            ]);

            res.json({
                webAnalytics,
                ignStats,
                commandAnalytics,
                requestMetrics: {
                    byEndpoint: requestsByEndpoint,
                    byStatus: requestsByStatus,
                    hourlyDistribution: hourlyRequests
                },
                referrals,
                performanceHistory,
                timestamp: now.toISOString()
            });
        } catch (err) {
            logger.error('Error fetching combined statistics:', err);
            res.status(500).json({ error: 'Failed to fetch statistics.' });
        }
    });
});

// RS Prediction API
router.get('/api/rs-prediction', async (req: Request, res: Response) => {
    try {
        const { getRSPrediction } = await import('@/util/rsPredictor');
        
        let days: number | undefined = undefined;
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
            currentRS:            prediction.currentRS,
            dailyChange:          prediction.dailyChange,
            safeRS:               prediction.safeRS,
            safeRS_min:           prediction.safeRS_min,
            safeRS_max:           prediction.safeRS_max,
            remainingDays:        prediction.remainingDays,
            dataPointsUsed:       prediction.dataPointsUsed,
            confidence:           prediction.confidence,
            standardError:        prediction.standardError,
            isSeasonEndRush:      prediction.isSeasonEndRush,
            rushMultiplier:       prediction.rushMultiplier,
            model:                prediction.model,
            historicalPrediction: prediction.historicalPrediction,
            historicalRange:      prediction.historicalRange,
            historicalR2:         prediction.historicalR2,
        });

    } catch (err) {
        logger.error('Error fetching RS prediction:', err);
        res.status(500).json({ error: 'Failed to generate RS prediction.' });
    }
});

/**
 * GET /api/active-streamers
 * Returns list of currently active stream sessions
 */
router.get('/api/active-streamers', async (req: Request, res: Response) => {
    try {
        // Find channels marked as live
        const activeChannels = await Channel.findAll({
            where: { is_live: true },
            attributes: ['username', 'stream_thumbnail_url'],
            limit: 12 // Limit to 12 active streamers
        });
        
        // Return structured data for frontend
        const activeStreamers = activeChannels.map((c: any) => ({
            channel: c.username,
            thumbnail_url: c.stream_thumbnail_url
        }));
        res.status(200).json(activeStreamers);
    } catch (err) {
        logger.error('Error fetching active streamers:', err);
        res.status(500).json({ error: 'Failed to fetch active streamers' });
    }
});

/**
 * POST /api/feedback
 * Submit user feedback
 */
router.post('/api/feedback', rateLimitFeedback, async (req: Request, res: Response) => {
    try {
        let { message, type } = req.body;

        // --- Input Validation ---
        if (!message || typeof message !== 'string') {
             res.status(400).json({ error: 'Message is required.' });
             return;
        }

        // Clean and trim message
        message = message.trim();

        // Max length check
        if (message.length < 5) {
            res.status(400).json({ error: 'Message is too short (min 5 characters).' });
            return;
        }
        if (message.length > 1000) {
            res.status(400).json({ error: 'Message is too long (max 1000 characters).' });
            return;
        }

        // Valid types check
        const allowedTypes = ['general', 'bug', 'feature', 'test'];
        if (type && !allowedTypes.includes(type)) {
            type = 'general'; // Default to general if invalid type provided
        }

        // Basic sanitization: remove HTML-like tags to prevent injection (though EJS/DB usually handles this)
        const sanitizedMessage = message.replace(/<[^>]*>?/gm, '');

        if (sanitizedMessage.length === 0) {
            res.status(400).json({ error: 'Invalid message content.' });
            return;
        }

        const { Feedback } = await import('@/db');
        
        let username: string | null = null;
        let userId: string | null = null;

        // Try to get user info from session if available
        if ((req as any).session && (req as any).session.username) {
            username = (req as any).session.username;
        }
        
        await Feedback.create({
            message: sanitizedMessage,
            type: type || 'general',
            username: username,
            user_id: userId
        });

        logger.info(`Feedback received from ${username || 'Anonymous'}: ${sanitizedMessage}`);

        // Send to Discord Webhook
        const discordWebhookUrl = 'https://discord.com/api/webhooks/1463388601831129285/ThIc8o8BkKdbvYGW_at6o5ETRGcAHDr4c4YYSmFBfdH1CwBhwhgMdnZ5U8c1qqNkwkyM';
        try {
            await axios.post(discordWebhookUrl, {
                embeds: [{
                    title: `📝 New Feedback (${type})`,
                    description: sanitizedMessage,
                    color: type === 'bug' ? 0xe74c3c : (type === 'feature' ? 0x3498db : 0x9146FF),
                    fields: [
                        { name: 'User', value: username || 'Anonymous', inline: true },
                        { name: 'Type', value: type || 'general', inline: true }
                    ],
                    timestamp: new Date().toISOString(),
                    footer: { text: 'FinalsRS Feedback System' }
                }]
            });
        } catch (discordErr) {
            logger.error('Failed to send feedback to Discord:', discordErr);
        }

        res.status(200).json({ success: true, message: 'Feedback submitted successfully.' });

    } catch (err) {
        logger.error('Error submitting feedback:', err);
        res.status(500).json({ error: 'Failed to submit feedback.' });
    }
});

//analytics dashboard for youtube video expirement
router.get('/analytics-dashboard', (req: Request, res: Response) => {
    res.sendFile(path.join(viewsPath, 'analytics-dashboard.html'));
})

// ─── Internal Bot Metrics ────────────────────────────────────────────────────

/**
 * GET /botmetrics/login
 * Simple password-protected login for the internal metrics page.
 */
router.get('/botmetrics/login', (req: any, res: Response) => {
    const csrfToken = req.csrfToken ? req.csrfToken() : '';
    const error = req.query.error ? 'Invalid password.' : '';
    res.send(`<!DOCTYPE html><html><head><title>Metrics Login</title><style>*{box-sizing:border-box}body{font-family:-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#0e0e10;color:#efeff1}.card{background:#18181b;padding:2rem 2.5rem;border-radius:10px;border:1px solid #2a2a2e;width:320px}.h{font-size:18px;font-weight:700;margin:0 0 1.5rem;color:#efeff1}.err{background:#3d1515;color:#f87171;padding:8px 12px;border-radius:6px;font-size:13px;margin-bottom:1rem}.lbl{font-size:12px;color:#adadb8;margin-bottom:4px}.inp{display:block;width:100%;padding:9px 12px;border-radius:6px;border:1px solid #2a2a2e;background:#0e0e10;color:#efeff1;font-size:14px;margin-bottom:1rem}.inp:focus{outline:none;border-color:var(--p,#9147ff)}.btn{width:100%;padding:10px;border:none;border-radius:6px;background:#9147ff;color:#fff;font-size:14px;font-weight:600;cursor:pointer}.btn:hover{background:#772ce8}</style></head><body><div class="card"><p class="h">Bot Metrics</p>${error ? `<div class="err">${error}</div>` : ''}<form method="POST" action="/botmetrics/login"><div class="lbl">Password</div><input class="inp" name="password" type="password" placeholder="Enter metrics password" autofocus required><input type="hidden" name="_csrf" value="${csrfToken}"><button class="btn" type="submit">Sign in</button></form></div></body></html>`);
});

/**
 * POST /botmetrics/login
 * Validate metrics password from METRICS_PASSWORD env var.
 */
router.post('/botmetrics/login', (req: any, res: Response) => {
    const { password } = req.body;
    const metricsPassword = process.env.METRICS_PASSWORD;

    if (!metricsPassword) {
        logger.warn('[Metrics] METRICS_PASSWORD env var is not set.');
        return res.redirect('/botmetrics/login?error=1');
    }

    if (password === metricsPassword) {
        req.session.isMetrics = true;
        logger.info('[Metrics] Metrics login successful.');
        return res.redirect('/botmetrics');
    }

    logger.warn('[Metrics] Failed metrics login attempt.');
    res.redirect('/botmetrics/login?error=1');
});

/**
 * GET /botmetrics
 * Internal metrics dashboard.
 */
router.get('/botmetrics', (req: any, res: Response) => {
    if (!req.session?.isMetrics) {
        return res.redirect('/botmetrics/login');
    }
    res.render('botmetrics');
});

/**
 * GET /api/internal/metrics?range=30m|1h|3h|6h
 * Returns live bot metrics data. Requires isMetrics session.
 * Always returns 60 graph buckets regardless of range.
 */
router.get('/api/internal/metrics', async (req: any, res: any) => {
    if (!req.session?.isMetrics) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const { Op } = await import('sequelize');

        // ── Resolve time range ────────────────────────────────────────────────
        const RANGES: Record<string, { windowMs: number; bucketMs: number; label: string }> = {
            '30m': { windowMs: 30 * 60_000,      bucketMs: 60_000,       label: '1 min'  },
            '1h':  { windowMs: 60 * 60_000,      bucketMs: 60_000,       label: '1 min'  },
            '3h':  { windowMs: 3 * 60 * 60_000,  bucketMs: 3 * 60_000,   label: '3 min'  },
            '6h':  { windowMs: 6 * 60 * 60_000,  bucketMs: 6 * 60_000,   label: '6 min'  },
        };
        const rangeKey = (typeof req.query.range === 'string' && RANGES[req.query.range])
            ? req.query.range
            : '1h';
        const { windowMs, bucketMs, label: bucketLabel } = RANGES[rangeKey];
        const numBuckets = Math.ceil(windowMs / bucketMs);

        const now = new Date();
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        const windowStart = new Date(now.getTime() - windowMs);

        const [
            channels,
            liveChannels,
            activeSessions,
            usersSeen,
            commandsToday,
            commandsSuccessToday,
            recentCmdRows,
            topChannels,
            topCommands,
            latestPerf,
            perfRows,
        ] = await Promise.all([
            Channel.count({ where: { bot_enabled: true } }),
            Channel.count({ where: { is_live: true } }),
            StreamSession.count(),
            CommandUsage.count({ distinct: true, col: 'user' } as any),
            CommandUsage.count({ where: { timestamp: { [Op.gte]: startOfDay } } }),
            CommandUsage.count({ where: { timestamp: { [Op.gte]: startOfDay }, success: true } }),

            // Cmd timestamps for the selected window
            CommandUsage.findAll({
                where: { timestamp: { [Op.gte]: windowStart } },
                attributes: ['timestamp'],
                raw: true,
            }),

            CommandUsage.findAll({
                where: { timestamp: { [Op.gte]: startOfDay } },
                attributes: [
                    'channel',
                    [CommandUsage.sequelize!.fn('COUNT', CommandUsage.sequelize!.col('id')), 'count'],
                ],
                group: ['channel'],
                order: [[CommandUsage.sequelize!.literal('count'), 'DESC']] as any,
                limit: 8,
                raw: true,
            }),

            CommandUsage.findAll({
                where: { timestamp: { [Op.gte]: startOfDay } },
                attributes: [
                    'command',
                    [CommandUsage.sequelize!.fn('COUNT', CommandUsage.sequelize!.col('id')), 'count'],
                ],
                group: ['command'],
                order: [[CommandUsage.sequelize!.literal('count'), 'DESC']] as any,
                limit: 8,
                raw: true,
            }),

            PerformanceMetric.findOne({ order: [['timestamp', 'DESC']], raw: true }),

            // Perf rows for the selected window
            PerformanceMetric.findAll({
                where: { timestamp: { [Op.gte]: windowStart } },
                attributes: ['timestamp', 'cpuUsage', 'memoryUsed', 'memoryTotal', 'botLatencyMs'],
                order: [['timestamp', 'ASC']],
                raw: true,
            }),
        ]);

        // ── Helper: build N buckets of bucketMs width going back from now ─────
        function buildBucketKeys(): string[] {
            const keys: string[] = [];
            for (let i = numBuckets - 1; i >= 0; i--) {
                const d = new Date(now.getTime() - i * bucketMs);
                keys.push(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
            }
            return keys;
        }

        // Assigns a row's timestamp to the correct bucket label.
        // bucketIndex=0 → most recent bucket (ref = now), matching buildBucketKeys i=0.
        function toBucketKey(ts: Date): string {
            const msFromNow = now.getTime() - ts.getTime();
            const bucketIndex = Math.floor(msFromNow / bucketMs);
            if (bucketIndex < 0 || bucketIndex >= numBuckets) return '';
            const bucketRef = new Date(now.getTime() - bucketIndex * bucketMs);
            return `${String(bucketRef.getHours()).padStart(2, '0')}:${String(bucketRef.getMinutes()).padStart(2, '0')}`;
        }

        const bucketKeys = buildBucketKeys();

        // ── Commands graph ────────────────────────────────────────────────────
        const cmdBuckets: Record<string, number> = Object.fromEntries(bucketKeys.map(k => [k, 0]));
        for (const row of recentCmdRows as any[]) {
            const key = toBucketKey(new Date(row.timestamp));
            if (key && key in cmdBuckets) cmdBuckets[key]++;
        }
        const minuteGraph = bucketKeys.map(k => ({ minute: k, count: cmdBuckets[k] }));

        // ── Perf graph ────────────────────────────────────────────────────────
        const perfBuckets: Record<string, { cpu: number[]; memMB: number[]; latencyMs: number[] }> =
            Object.fromEntries(bucketKeys.map(k => [k, { cpu: [], memMB: [], latencyMs: [] }]));
        for (const row of perfRows as any[]) {
            const key = toBucketKey(new Date(row.timestamp));
            if (key && key in perfBuckets) {
                if (row.cpuUsage != null)     perfBuckets[key].cpu.push(row.cpuUsage);
                if (row.memoryUsed != null)   perfBuckets[key].memMB.push(row.memoryUsed / 1_048_576);
                if (row.botLatencyMs != null) perfBuckets[key].latencyMs.push(row.botLatencyMs);
            }
        }
        const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
        const perfGraph = bucketKeys.map(k => ({
            minute:    k,
            cpu:       avg(perfBuckets[k].cpu),
            memMB:     avg(perfBuckets[k].memMB),
            latencyMs: avg(perfBuckets[k].latencyMs),
        }));

        // ── Chat rate graph — fetched from bot process (localhost:4000) ──────
        let chatGraph: { minute: string; in: number; out: number }[] = [];
        try {
            const chatRes = await axios.get(
                `http://localhost:4000/metrics/chat?window=${windowMs}&bucket=${bucketMs}`,
                { timeout: 1500 }
            );
            if (Array.isArray(chatRes.data)) chatGraph = chatRes.data;
        } catch {
            // Bot process unreachable — return empty graph, don't fail the whole response
        }

        const successRate = commandsToday > 0
            ? Math.round((commandsSuccessToday / commandsToday) * 1000) / 10
            : 100;

        res.json({
            channels,
            liveChannels,
            activeSessions,
            usersSeen,
            commandsToday,
            successRate,
            uptime: Math.floor(process.uptime()),
            latestPerf: latestPerf ?? null,
            minuteGraph,
            perfGraph,
            chatGraph,
            topChannels,
            topCommands,
            range: rangeKey,
            bucketLabel,
        });
    } catch (err) {
        logger.error('[Metrics] Error fetching internal metrics:', err);
        res.status(500).json({ error: 'Failed to fetch metrics.' });
    }
});

// ── Leaderboard page ──────────────────────────────────────────
router.get('/leaderboard', (_req: Request, res: Response) => {
    res.sendFile(path.join(viewsPath, 'leaderboard.html'));
});

// ── Leaderboard data API ──────────────────────────────────────
router.get('/api/leaderboard', async (req: Request, res: Response) => {
    const cacheDir = path.join(process.cwd(), 'cache');
    const mode = req.query.mode === 'wt' ? 'wt' : 'ranked';
    const prefix = mode === 'wt' ? 'worldTour_s' : 'regular_s';

    try {
        const files = await fs.promises.readdir(cacheDir);
        const matched = files
            .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
            .map(f => {
                const num = parseInt(f.match(/\d+/)?.[0] ?? '0', 10);
                return { file: f, season: num };
            })
            .filter(x => x.season > 0)
            .sort((a, b) => b.season - a.season);

        if (!matched.length) {
            res.status(404).json({ error: 'No leaderboard data found.' });
            return;
        }

        const latest = matched[0];
        const filePath = path.join(cacheDir, latest.file);
        const stat = await fs.promises.stat(filePath);
        const raw = await fs.promises.readFile(filePath, 'utf8');
        const data = JSON.parse(raw);

        res.json({
            season: latest.season,
            mode,
            updated: stat.mtime.toISOString(),
            data: Array.isArray(data) ? data : [],
        });
    } catch (err) {
        logger.error('[leaderboard] Error reading cache:', err);
        res.status(500).json({ error: 'Failed to load leaderboard data.' });
    }
});

export default router;