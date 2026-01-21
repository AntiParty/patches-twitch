import { Request, Response, NextFunction } from "express";
import { Op } from "sequelize";
import { RequestMetric, AnalyticsDay, metricsDbReady } from '@/dbMetrics';
import logger from '@/util/logger';

// ---------- Tracking ----------
const IGNORED_EXTS = ['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2', '.ttf', '.map'];
//ignore any api/overlay/data/ endpoints & api/overlay/config/
const IGNORED_PATHS = ['/api/', '/health', '/api/overlay/data/', '/api/overlay/config/', '/api/statistics', ];
/**
 * 
 * @param req 
 * @param res 
 * @param next 
 */

export function trackRequest(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  res.on("finish", () => {
    const endpoint = req.originalUrl.split("?")[0];

    // Skip static assets
    if (IGNORED_EXTS.some(ext => endpoint.endsWith(ext))) return;
    // Skip ignored paths
    if (IGNORED_PATHS.some(path => endpoint.startsWith(path))) return;

    const duration = Date.now() - start;
    const method = req.method;
    const statusCode = res.statusCode;
    const ip = req.ip || 'unknown';
    const userAgent = (req.headers["user-agent"] || "unknown").slice(0, 255);
    const referer = (req.headers["referer"] || "direct").slice(0, 255);

    metricsDbReady.then(() => {
      RequestMetric.create({
        timestamp: new Date(),
        endpoint,
        method,
        responseTimeMs: duration,
        statusCode,
        ip,
        userAgent,
        referer
      }).catch(err => {
        logger.error('[analytics] Failed to log request:', err);
      });
    });
  });

  next();
}

// ---------- Aggregation ----------

/**
 * Empty export to maintain compatibility if this was called externally
 * in the old version (though user said "doesn't store it in memory", so we don't load/save).
 */
export function loadAnalytics() {
  // No-op
}

export function saveAnalytics() {
  // No-op
}

/**
 * Generates the stats object for a given set of rows (from RequestMetric query)
 */
function aggregateRows(rows: any[]) {
  const stats = {
    totalRequests: 0,
    perRoute: {} as Record<string, number>,
    uniqueVisitors: 0,
    avgResponseTimeMs: 0,
    p95ResponseTimeMs: 0,
    statusCodes: {} as Record<number, number>,
    topUserAgents: {} as Record<string, number>,
    topReferrers: {} as Record<string, number>,
  };

  if (rows.length === 0) return stats;

  const uniqueIps = new Set<string>();
  const responseTimes: number[] = [];
  const userAgents: Record<string, number> = {};
  const referrers: Record<string, number> = {};

  rows.forEach(r => {
    stats.totalRequests++;

    // Count route
    stats.perRoute[r.endpoint] = (stats.perRoute[r.endpoint] || 0) + 1;

    // Unique IP
    if (r.ip) uniqueIps.add(r.ip);

    // Response time
    responseTimes.push(r.responseTimeMs);

    // Status code
    stats.statusCodes[r.statusCode] = (stats.statusCodes[r.statusCode] || 0) + 1;

    // Use full UA/Ref for counting, then slice top N later
    const ua = r.userAgent || 'unknown';
    userAgents[ua] = (userAgents[ua] || 0) + 1;

    const ref = r.referer || 'direct';
    referrers[ref] = (referrers[ref] || 0) + 1;
  });

  stats.uniqueVisitors = uniqueIps.size;

  // Calc avg
  const sum = responseTimes.reduce((a, b) => a + b, 0);
  stats.avgResponseTimeMs = Math.round(sum / responseTimes.length);

  // Calc p95
  responseTimes.sort((a, b) => a - b);
  const idx = Math.floor(0.95 * (responseTimes.length - 1));
  stats.p95ResponseTimeMs = responseTimes[idx] || 0;

  // Top N helper
  const getTopN = (source: Record<string, number>, n: number) => {
    return Object.fromEntries(
      Object.entries(source).sort((a, b) => b[1] - a[1]).slice(0, n)
    );
  };

  stats.topUserAgents = getTopN(userAgents, 5);
  stats.topReferrers = getTopN(referrers, 5);

  return stats;
}

/**
 * Returns analytics. 
 * Strategies:
 * 1. Fetch historical days from AnalyticsDay table.
 * 2. Fetch "today's" stats using aggregated database queries to save RAM.
 */
export async function getAnalytics() {
  await metricsDbReady;

  // 1. Get History
  const historyRows = await AnalyticsDay.findAll();
  const result: Record<string, any> = {};

  historyRows.forEach((row: any) => {
    result[row.day] = {
      totalRequests: row.totalRequests,
      perRoute: JSON.parse(row.perRoute || '{}'),
      uniqueVisitors: row.uniqueVisitors,
      avgResponseTimeMs: row.avgResponseTimeMs,
      p95ResponseTimeMs: row.p95ResponseTimeMs,
      statusCodes: JSON.parse(row.statusCodes || '{}'),
      topUserAgents: JSON.parse(row.userAgents || '{}'),
      topReferrers: JSON.parse(row.referrers || '{}'),
    };
  });

  // 2. Aggregate Today (Memory Efficient Approach)
  const todayStr = new Date().toISOString().slice(0, 10);
  const startOfToday = new Date(todayStr);

  // Check if we have any requests today
  const totalRequests = await RequestMetric.count({
    where: { timestamp: { [Op.gte]: startOfToday } }
  });

  if (totalRequests > 0) {
    // Helper to get grouped counts
    const getGroupedCounts = async (column: string, limit?: number) => {
      const rows = await RequestMetric.findAll({
        attributes: [column, [RequestMetric.sequelize!.fn('COUNT', RequestMetric.sequelize!.col(column)), 'count']],
        where: { timestamp: { [Op.gte]: startOfToday } },
        group: [column],
        order: [[RequestMetric.sequelize!.literal('count'), 'DESC']],
        limit,
        raw: true
      });
      return Object.fromEntries(rows.map((r: any) => [r[column] || 'unknown', r.count]));
    };

    const [perRoute, statusCodes, topUserAgents, topReferrers, uniqueVisitors, avgResponseTime] = await Promise.all([
      getGroupedCounts('endpoint'),
      getGroupedCounts('statusCode'),
      getGroupedCounts('userAgent', 5),
      getGroupedCounts('referer', 5),
      RequestMetric.count({
        where: { timestamp: { [Op.gte]: startOfToday } },
        distinct: true,
        col: 'ip'
      }),
      RequestMetric.sequelize!.query(
        'SELECT AVG(responseTimeMs) as avg FROM RequestMetrics WHERE timestamp >= :start',
        { replacements: { start: startOfToday.toISOString() }, type: 'SELECT' }
      )
    ]);

    // p95 is harder in SQLite; we'll fetch just the response times (lower RAM than full rows)
    const responseTimes = await RequestMetric.findAll({
      attributes: ['responseTimeMs'],
      where: { timestamp: { [Op.gte]: startOfToday } },
      order: [['responseTimeMs', 'ASC']],
      raw: true
    }) as any[];
    
    const p95Idx = Math.floor(0.95 * (responseTimes.length - 1));
    const p95ResponseTimeMs = responseTimes[p95Idx]?.responseTimeMs || 0;

    result[todayStr] = {
      totalRequests,
      perRoute,
      uniqueVisitors,
      avgResponseTimeMs: Math.round((avgResponseTime[0] as any)?.avg || 0),
      p95ResponseTimeMs,
      statusCodes,
      topUserAgents,
      topReferrers
    };
  } else if (!result[todayStr]) {
    result[todayStr] = aggregateRows([]);
  }

  // Sort keys
  const sortedKeys = Object.keys(result).sort();
  const dailyStats = Object.fromEntries(sortedKeys.map(k => [k, result[k]]));

  // Calculate Global Totals
  let grandTotalRequests = 0;
  const grandTotalPerRoute: Record<string, number> = {};

  Object.values(dailyStats).forEach((dayIdx: any) => {
    grandTotalRequests += dayIdx.totalRequests || 0;
    if (dayIdx.perRoute) {
      Object.entries(dayIdx.perRoute).forEach(([route, count]) => {
        grandTotalPerRoute[route] = (grandTotalPerRoute[route] || 0) + (count as number);
      });
    }
  });

  return { daily: dailyStats, totalRequests: grandTotalRequests, totalPerRoute: grandTotalPerRoute };
}