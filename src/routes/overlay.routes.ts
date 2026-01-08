// Overlay API Routes for FinalsRS Stream Overlays
import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Channel, StreamSession } from '../db';
import logger from '../util/logger';
import { requireUserAPI } from '@/middleware/auth.middleware';
import { rateLimitRegenerate } from '@/middleware/security';

const router = Router();

/**
 * SESSION-BASED ENDPOINTS (for the dashboard)
 */

// GET /api/overlay/token - return overlay token for current logged-in user
router.get('/api/overlay/token', requireUserAPI, async (req: any, res: any) => {
    try {
        const username = req.session.twitchUsername;
        const user: any = await Channel.findOne({ where: { username } });
        if (!user) return res.status(404).json({ error: 'User not found' });

        let token = user.get('overlay_token');
        if (!token) {
            token = crypto.randomBytes(32).toString('hex');
            await user.update({ overlay_token: token });
            logger.info(`[Overlay] Generated token for ${username}`);
        }

        res.json({ token });
    } catch (err) {
        logger.error('[Overlay] Error fetching token:', err);
        res.status(500).json({ error: 'Failed to fetch token' });
    }
});

// POST /api/overlay/regenerate-token - regenerate overlay token for current user
router.post('/api/overlay/regenerate-token', requireUserAPI, rateLimitRegenerate, async (req: any, res: any) => {
    try {
        const username = req.session.twitchUsername;
        const user: any = await Channel.findOne({ where: { username } });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const token = crypto.randomBytes(32).toString('hex');
        await user.update({ overlay_token: token });
        logger.info(`[Overlay] Regenerated token for ${username}`);
        res.json({ token });
    } catch (err) {
        logger.error('[Overlay] Error regenerating token:', err);
        res.status(500).json({ error: 'Failed to regenerate token' });
    }
});


/**
 * PUBLIC/TOKEN-BASED ENDPOINTS (for the overlay files)
 */

// Generate or retrieve overlay token for authenticated user (legacy/named params)
router.get('/api/overlay/:username/token', async (req: any, res: any) => {
    if (!req.session?.isUser || !req.session.twitchUsername) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.session.twitchUsername !== req.params.username) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    try {
        let user: any = await Channel.findOne({ where: { username: req.params.username } });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        let token = user.get('overlay_token');

        if (!token) {
            token = crypto.randomBytes(32).toString('hex');
            await user.update({ overlay_token: token });
            logger.info(`[Overlay] Generated new token for ${req.params.username}`);
        }

        res.json({ token });
    } catch (err) {
        logger.error('Error generating overlay token:', err);
        res.status(500).json({ error: 'Failed to generate token' });
    }
});

// Regenerate overlay token (legacy/named params)
router.post('/api/overlay/:username/regenerate-token', async (req: any, res: any) => {
    if (!req.session?.isUser || !req.session.twitchUsername) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.session.twitchUsername !== req.params.username) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    try {
        const token = crypto.randomBytes(32).toString('hex');

        await Channel.update(
            { overlay_token: token },
            { where: { username: req.params.username } }
        );

        logger.info(`[Overlay] Regenerated token for ${req.params.username}`);
        res.json({ token });
    } catch (err) {
        logger.error('Error regenerating overlay token:', err);
        res.status(500).json({ error: 'Failed to regenerate token' });
    }
});

// Helper to find latest cache file (adapted from rank.ts)
async function getLatestCacheFile(prefix: string): Promise<string | null> {
    try {
        const cacheDir = path.join(process.cwd(), 'cache');
        if (!fs.existsSync(cacheDir)) return null;

        const files = fs.readdirSync(cacheDir);
        const matched = files
            .filter(f => f.startsWith(prefix) && f.endsWith(".json"))
            .map(f => {
                const num = parseInt(f.match(/\d+/)?.[0] ?? "0", 10);
                return { file: f, season: num };
            })
            .filter(x => x.season > 0)
            .sort((a, b) => b.season - a.season); // newest first

        return matched.length > 0 ? path.join(cacheDir, matched[0].file) : null;
    } catch (err) {
        logger.error(`[Overlay] Failed to list cache files for ${prefix}:`, err);
        return null; // Return null on error
    }
}

// Fetch overlay data using token (PUBLIC endpoint - rate limited recommended)
router.get('/api/overlay/data/:token', async (req: any, res: any) => {
    try {
        const { token } = req.params;

        const user: any = await Channel.findOne({ where: { overlay_token: token } });

        if (!user) {
            return res.status(404).json({ error: 'Invalid token' });
        }

        // Get the identifying name
        const finalsName = user.get('player_id') || user.get('username');
        const searchName = finalsName.toLowerCase();

        // 1. Fetch Regular Leaderboard Data
        let stats: any = {};
        try {
            const regularFile = await getLatestCacheFile("regular_s");
            if (regularFile) {
                const raw = fs.readFileSync(regularFile, "utf8");
                const data = JSON.parse(raw);
                if (Array.isArray(data)) {
                    const found = data.find((p: any) => p.name.toLowerCase() === searchName);
                    if (found) {
                        stats = found;
                    }
                }
            }
        } catch (err) {
            logger.error(`[Overlay] Error reading regular leaderboard for ${finalsName}:`, err);
        }

        // 2. Fetch World Tour Data
        let wtRank = "N/A";
        try {
            const wtFile = await getLatestCacheFile("worldTour_s");
            if (wtFile) {
                const raw = fs.readFileSync(wtFile, "utf8");
                const data = JSON.parse(raw);
                if (Array.isArray(data)) {
                    const found = data.find((p: any) => p.name.toLowerCase() === searchName);
                    if (found) {
                        wtRank = `#${found.rank}`;
                    }
                }
            }
        } catch (err) {
            logger.error(`[Overlay] Error reading WT leaderboard for ${finalsName}:`, err);
        }

        // Get rank goal if exists
        const { RankGoal } = await import('../db');
        const goal: any = await RankGoal.findOne({ where: { channel: user.get('username') } });

        // Calculate session change
        let startRS = user.get('session_start_rs');
        let usingStreamSession = false;

        // Priority 1: Check for active StreamSession (matches !record command)
        const activeSession: any = await StreamSession.findOne({ where: { channel: user.get('username') } });
        
        if (activeSession) {
            startRS = activeSession.start_score;
            usingStreamSession = true;
        } 
        
        // Priority 2: Fallback to Channel session (manual/persistent)
        // Auto-initialize session start if not set and no stream session
        if (!usingStreamSession && (startRS === null || startRS === undefined)) {
            startRS = stats.rankScore || 0;
            // Only update if we have actual stats to init with
            if (stats.rankScore !== undefined) {
                user.update({ session_start_rs: startRS }).catch((e: any) => 
                    logger.error(`[Overlay] Failed to auto-init session for ${finalsName}`, e)
                );
            }
        }

        const sessionChange = (stats.rankScore !== undefined && startRS !== undefined)
            ? (stats.rankScore - startRS)
            : 0;

        // Return overlay data
        res.json({
            // Standard fields expected by overlays
            playerName: stats.name || finalsName,
            username: stats.name || finalsName, // legacy support
            
            rank: stats.rank || 'N/A',
            league: stats.league || 'Unranked',
            rankScore: stats.rankScore || 0,
            
            worldTourRank: wtRank,
            wtRank: wtRank, // legacy support

            sessionChange: sessionChange, // flattened for overlays
            
            goal: null,
            session: {
                startRS: startRS || 0,
                currentRS: stats.rankScore || 0,
                change: sessionChange
            },
            lastUpdated: new Date().toISOString()
        });
    } catch (err) {
        logger.error('Error fetching overlay data:', err);
        res.status(500).json({ error: 'Failed to fetch overlay data' });
    }
});

// Get overlay configuration
router.get('/api/overlay/config/:token', async (req: any, res: any) => {
    try {
        const user: any = await Channel.findOne({ where: { overlay_token: req.params.token } });

        if (!user) {
            return res.status(404).json({ error: 'Invalid token' });
        }

        let layoutData = { mode: 'compact', visibility: {} };
        const rawLayout = user.get('overlay_layout');
        if (rawLayout) {
            if (rawLayout.startsWith('{') || rawLayout.startsWith('[')) {
                try { layoutData = JSON.parse(rawLayout); } catch (e) { }
            } else {
                layoutData.mode = rawLayout;
            }
        }

        res.json({
            theme: user.get('overlay_theme') || 'minimal',
            primaryColor: user.get('overlay_color') || '#9147ff',
            layout: layoutData
        });
    } catch (err) {
        logger.error('Error fetching overlay config:', err);
        res.status(500).json({ error: 'Failed to fetch config' });
    }
});

// Update overlay configuration
router.post('/api/overlay/config', async (req: any, res: any) => {
    if (!req.session?.isUser || !req.session.twitchUsername) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const { theme, primaryColor, layoutMode, visibility } = req.body;
        const username = req.session.twitchUsername;

        const updateData: any = {};
        if (theme !== undefined) updateData.overlay_theme = theme;
        if (primaryColor !== undefined) updateData.overlay_color = primaryColor;
        
        // Handle layout JSON
        if (layoutMode !== undefined || visibility !== undefined) {
            // First fetch current to keep existing values if some are missing
            const user: any = await Channel.findOne({ where: { username } });
            let currentLayout: any = { mode: 'compact', visibility: {} };
            if (user && user.get('overlay_layout')) {
                try {
                    currentLayout = JSON.parse(user.get('overlay_layout'));
                } catch (e) {
                    if (typeof user.get('overlay_layout') === 'string') {
                        currentLayout.mode = user.get('overlay_layout');
                    }
                }
            }

            const newLayout = {
                mode: layoutMode !== undefined ? layoutMode : currentLayout.mode,
                visibility: visibility !== undefined ? visibility : currentLayout.visibility
            };
            updateData.overlay_layout = JSON.stringify(newLayout);
        }

        if (Object.keys(updateData).length > 0) {
            await Channel.update(updateData, { where: { username } });
        }

        logger.info(`[Overlay] ${username} updated overlay config`);
        res.json({ success: true });
    } catch (err) {
        logger.error('Error updating overlay config:', err);
        res.status(500).json({ error: 'Failed to update config' });
    }
});

// Reset session RS (for tracking session gains)
router.post('/api/overlay/reset-session', async (req: any, res: any) => {
    if (!req.session?.isUser || !req.session.twitchUsername) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const username = req.session.twitchUsername;
        const user: any = await Channel.findOne({ where: { username } });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Get current RS from cache
        const cachePath = path.join(process.cwd(), 'cache', `${user.get('player_id') || username}.json`);
        let currentRS = 0;

        if (fs.existsSync(cachePath)) {
            const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
            currentRS = cacheData.rankScore || 0;
        }

        await user.update({ session_start_rs: currentRS });
        
        // Also update active stream session if exists to keep them in sync
        const activeSession = await StreamSession.findOne({ where: { channel: username } });
        if (activeSession) {
            await activeSession.update({ start_score: currentRS });
        }

        logger.info(`[Overlay] ${username} reset session to ${currentRS} RS`);
        res.json({ success: true, sessionRS: currentRS });
    } catch (err) {
        logger.error('Error resetting session:', err);
        res.status(500).json({ error: 'Failed to reset session' });
    }
});

export default router;