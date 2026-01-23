/**
 * Developer API Routes
 * Public-facing API for third-party developers
 */
import { Router, Request, Response } from 'express';
import { getRSPrediction } from '@/util/rsPredictor';
import logger from '@/util/logger';
import { rateLimitByIP } from '@/middleware/security';
import path from 'path';
import fs from 'fs/promises';
import { Channel } from '@/db';

const router = Router();

// Helper: Get latest leaderboard file
async function getLatestCacheFile(prefix: string): Promise<string | null> {
    const cacheDir = path.resolve(process.cwd(), "cache");
    try {
        const files = await fs.readdir(cacheDir);
        const matched = files
            .filter(f => f.startsWith(prefix) && f.endsWith(".json"))
            .map(f => ({ file: f, season: parseInt(f.match(/\d+/)?.[0] ?? "0", 10) }))
            .filter(x => x.season > 0)
            .sort((a, b) => b.season - a.season);
        return matched.length > 0 ? path.join(cacheDir, matched[0].file) : null;
    } catch { return null; }
}

// CORS Middleware for Developer API
const allowCors = (req: Request, res: Response, next: Function) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
    }
    next();
};

// Apply middleware to all /api/v1 routes
router.use('/api/v1', allowCors);
router.use('/api/v1', rateLimitByIP); // Basic IP rate limiting

/**
 * GET /api/v1/leaderboard/cutoff
 * Returns the predicted Top 500 cutoff
 */
router.get('/api/v1/leaderboard/cutoff', async (req: Request, res: Response) => {
    try {
        // Parse optional 'days' parameter
        let days: number | undefined = undefined;
        if (req.query.days) {
            const parsed = parseInt(req.query.days as string, 10);
            if (!isNaN(parsed) && parsed > 0 && parsed <= 365) {
                days = parsed;
            }
        }

        const prediction = await getRSPrediction(days);

        if (!prediction) {
            res.status(503).json({
                error: {
                    code: 'insufficient_data',
                    message: "Not enough historical data to generate a prediction yet."
                }
            });
            return;
        }

        // Standardized JSON Response
        res.json({
            meta: {
                generated_at: new Date().toISOString(),
                api_version: "v1",
                documentation: "https://finalsrs.com/docs/api"
            },
            data: {
                current_cutoff_rs: prediction.currentRS,
                prediction: {
                    target_date_days: prediction.remainingDays,
                    predicted_rs: prediction.safeRS,
                    confidence_interval: {
                        min: prediction.safeRS_min,
                        max: prediction.safeRS_max
                    },
                    trend: {
                        daily_change: prediction.dailyChange,
                        slope_standard_error: prediction.standardError
                    },
                    season_rush: {
                        active: prediction.isSeasonEndRush,
                        multiplier: prediction.rushMultiplier
                    }
                },
                confidence_level: prediction.confidence
            }
        });

    } catch (err) {
        logger.error('[DevAPI] Error in cutoff prediction:', err);
        res.status(500).json({ 
            error: {
                code: 'internal_error',
                message: "An internal server error occurred."
            }
        });
    }
});

/**
 * GET /api/v1/player/:name
 * Lookup player stats from the latest leaderboard
 * Note: URL-encode the # character as %23 when including tags
 * Example: https://finalsrs.com/api/v1/player/PlayerName%23Tag
 */
router.get('/api/v1/player/:name', async (req: Request, res: Response) => {
    try {
        const nameQuery = req.params.name.toLowerCase().trim();
        
        // Load latest leaderboard data
        const leaderboardPath = await getLatestCacheFile("regular_s");
        
        if (!leaderboardPath) {
             res.status(503).json({ error: { code: 'unavailable', message: "Leaderboard data unavailable." }});
             return;
        }

        const rawData = await fs.readFile(leaderboardPath, "utf8");
        const leaderboard = JSON.parse(rawData);
        
        // Find player (exact match or Name#Tag)
        const player = leaderboard.find((p: any) => p.name.toLowerCase() === nameQuery);

        if (!player) {
            res.status(404).json({ error: { code: 'not_found', message: "Player not found in Top 1000." }});
            return;
        }

        res.json({
            meta: { generated_at: new Date().toISOString() },
            data: {
                name: player.name,
                rank: player.rank,
                league: player.league,
                rank_score: player.rankScore,
                movement: {
                    rank_change: player.rankChange || 0,
                    score_change: player.scoreChange || 0
                },
                updated_at: player.date // Assuming cached file has this, or we rely on file time
            }
        });

    } catch (err) {
        logger.error('[DevAPI] Error in player lookup:', err);
        res.status(500).json({ error: { code: 'internal_error', message: "Internal server error." }});
    }
});

// Alias for convenience
router.get('/api/v1/predict', (req, res) => res.redirect('/api/v1/leaderboard/cutoff'));

export default router;
