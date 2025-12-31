import { Request, Response } from 'express';
import fetch from 'node-fetch';
import { IGNVisit, metricsDbReady } from '@/dbMetrics';
import { Op, Sequelize } from 'sequelize';
import logger from '@/util/logger';

const BOT_KEYWORDS = [
    'bot', 'spider', 'crawler', 'python-requests', 'node-fetch', 'axios', 'curl', 'wget',
    'googlebot', 'bingbot', 'yandexbot', 'duckduckbot', 'slurp', 'baiduspider',
    'headless', 'lighthouse', 'inspect'
];

let isAntipartyLive = false;
let currentStreamId: string | null = null;
let currentStreamTitle: string | null = null;
const ANTIPARTY_TWITCH_ID = '660153356';

async function updateLiveStatus() {
    try {
        const clientId = process.env.TWITCH_CLIENT_ID;
        let appToken = process.env.TWITCH_APP_ACCESS_TOKEN;
        
        if (!clientId) return;
        
        // If no app token, we might need to wait for twitchUtils to refresh it
        // or we can try to trigger a refresh if we're feeling bold
        if (!appToken) {
             const { refreshToken } = await import('@/util/twitchUtils');
             try {
                 appToken = await refreshToken();
             } catch (e) {
                 return;
             }
        }

        const url = `https://api.twitch.tv/helix/streams?user_id=${ANTIPARTY_TWITCH_ID}`;
        const res = await fetch(url, {
            headers: {
                'Client-ID': clientId,
                'Authorization': `Bearer ${appToken}`
            }
        });

        if (res.status === 401) {
            // Token likely expired, trigger a background refresh for next time
            const { refreshToken } = await import('@/util/twitchUtils');
            await refreshToken();
            return;
        }

        const data = await res.json() as any;
        if (data.data && data.data.length > 0) {
            isAntipartyLive = true;
            currentStreamId = data.data[0].id;
            currentStreamTitle = data.data[0].title;
        } else {
            isAntipartyLive = false;
            currentStreamId = null;
            currentStreamTitle = null;
        }
    } catch (err) {
        logger.error('[IGN-STATS] Live status check failed:', err);
    }
}

// Initial check and periodic update
updateLiveStatus();
setInterval(updateLiveStatus, 120000); // Check every 2 minutes

/**
 * Tracks a visit specifically for the IGN/YouTube experiment.
 * Filters out common bots and static assets.
 */
export async function trackIGNVisit(req: Request) {
    try {
        const userAgent = (req.headers['user-agent'] || '').toLowerCase();
        const path = req.path;
        // Only track the root path (homepage) for the IGN experiment
        if (path !== '/') return;

        // Skip common bots
        if (BOT_KEYWORDS.some(kw => userAgent.includes(kw))) return;

        await metricsDbReady;
        
        await IGNVisit.create({
            timestamp: new Date(),
            ip: req.ip || 'unknown',
            userAgent: req.headers['user-agent']?.slice(0, 255) || 'unknown',
            referer: req.headers['referer']?.slice(0, 255) || 'direct',
            path: path,
            isLive: isAntipartyLive,
            streamId: currentStreamId,
            streamTitle: currentStreamTitle
        });
    } catch (err) {
        logger.error('[IGN-STATS] Failed to track visit:', err);
    }
}

/**
 * Aggregates statistics for the IGN dashboard.
 */
export async function getIGNStats() {
    await metricsDbReady;

    const now = new Date();
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [total, today, last7days, last5min, totalLive, recentRows, dailyRows, streamRows] = await Promise.all([
        IGNVisit.count(),
        IGNVisit.count({ where: { timestamp: { [Op.gte]: todayStart } } }),
        IGNVisit.count({ where: { timestamp: { [Op.gte]: sevenDaysAgo } } }),
        IGNVisit.count({ where: { timestamp: { [Op.gte]: fiveMinAgo } } }),
        IGNVisit.count({ where: { isLive: true } }),
        IGNVisit.findAll({
            order: [['timestamp', 'DESC']],
            limit: 10
        }),
        IGNVisit.findAll({
            attributes: [
                [Sequelize.fn('strftime', '%Y-%m-%d', Sequelize.col('timestamp')), 'day'],
                [Sequelize.fn('COUNT', Sequelize.col('id')), 'count'],
                [Sequelize.fn('SUM', Sequelize.literal('CASE WHEN isLive THEN 1 ELSE 0 END')), 'liveCount']
            ],
            where: { timestamp: { [Op.gte]: sevenDaysAgo } },
            group: ['day'],
            order: [['day', 'ASC']],
            raw: true
        }),
        IGNVisit.findAll({
            attributes: [
                'streamId',
                'streamTitle',
                [Sequelize.fn('MIN', Sequelize.col('timestamp')), 'startTime'],
                [Sequelize.fn('COUNT', Sequelize.col('id')), 'hits']
            ],
            where: { streamId: { [Op.ne]: null } },
            group: ['streamId'],
            order: [[Sequelize.fn('MIN', Sequelize.col('timestamp')), 'DESC']],
            limit: 5,
            raw: true
        })
    ]);

    const dailyBreakdown = dailyRows.map((r: any) => ({
        day: r.day,
        count: r.count,
        liveCount: parseInt(r.liveCount) || 0
    }));

    const recentStreams = streamRows.map((s: any) => ({
        id: s.streamId,
        title: s.streamTitle || 'Untitled Stream',
        startTime: s.startTime,
        hits: s.hits
    }));

    const recentVisits = recentRows.map((v: any) => {
        const ts = new Date(v.timestamp);
        const secondsAgo = Math.floor((now.getTime() - ts.getTime()) / 1000);
        
        let agent = v.userAgent || 'Unknown';
        if (agent.includes('Windows')) agent = 'Windows / Browser';
        else if (agent.includes('iPhone') || agent.includes('Android')) agent = 'Mobile / Browser';
        else if (agent.length > 50) agent = agent.substring(0, 47) + '...';

        return {
            secondsAgo: Math.max(0, secondsAgo),
            agent,
            isLive: v.isLive,
            streamTitle: v.streamTitle,
            source: v.referer.includes('google') ? 'Google' : 
                    v.referer.includes('bing') ? 'Bing' :
                    v.referer.includes('twitch') ? 'Twitch' : 
                    v.referer === 'direct' ? 'Direct / IGN' : 'Other External'
        };
    });

    return {
        total,
        today,
        last7days,
        last5min,
        totalLive,
        isCurrentlyLive: isAntipartyLive,
        dailyBreakdown,
        recentStreams,
        recentVisits
    };
}
