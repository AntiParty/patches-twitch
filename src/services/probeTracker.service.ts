/**
 * Vulnerability-scanner probe tracking.
 *
 * Classified probes (util/probeClassifier) are aggregated in memory and flushed
 * once a minute as upserts into small per-day rollup tables in metrics.sqlite.
 * Storage is bounded by per-day caps on distinct paths/sources, a fixed-size
 * sample table, and retention in dbMetrics' daily cleanup (detail 30 days,
 * per-category totals 1 year).
 *
 * Privacy: sources are stored as a keyed hash (for distinct counts) plus a
 * truncated IP (IPv4 /24, IPv6 /48) for display. Full IPs are never stored.
 */
import crypto from 'crypto';
import net from 'net';
import { Request, Response, NextFunction } from 'express';
import { QueryTypes } from 'sequelize';
import { metricsDbReady, sequelizeMetrics, ProbeSample } from '@/dbMetrics';
import { classifyProbe, PROBE_CATEGORIES, ProbeCategory, ProbeMatch } from '@/util/probeClassifier';
import logger from '@/util/logger';

export const PROBE_LIMITS = {
    maxPathsPerDay: 2000,
    maxSourcesPerDay: 5000,
    maxPendingSamples: 50,
    maxStoredSamples: 500,
    detailRetentionDays: 30,
    totalsRetentionDays: 365,
};

const OVERFLOW_PATH = '(other paths)';
const OVERFLOW_SOURCE = 'overflow';
const QUERY_RULES = new Set(['cgi-dash-arg', 'cgi-soft-hyphen', 'session-upload-progress']);

export interface ProbeHit {
    match: ProbeMatch;
    timestamp: Date;
    method: string;
    url: string;
    statusCode: number | null;
    sourceHash: string;
    sourcePrefix: string | null;
    userAgent: string | null;
}

export interface ProbeBatch {
    totals: { day: string; category: ProbeCategory; count: number }[];
    sources: { day: string; category: ProbeCategory; sourceHash: string; sourcePrefix: string | null; count: number }[];
    paths: { day: string; category: ProbeCategory; path: string; count: number }[];
    samples: ProbeHit[];
}

export function utcDay(date: Date): string {
    return date.toISOString().slice(0, 10);
}

/** IPv4 → a.b.c.x, IPv6 → first three hextets + ::/48. */
export function truncateIp(ip: string | undefined | null): string | null {
    if (!ip) return null;
    const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
    if (v4 === '::1' || v4.startsWith('127.')) return 'localhost';
    if (net.isIPv4(v4)) return v4.split('.').slice(0, 3).join('.') + '.x';
    if (!net.isIPv6(ip)) return null;
    const [head, tail = ''] = ip.split('::');
    const headParts = head ? head.split(':') : [];
    const tailParts = tail ? tail.split(':') : [];
    const groups = ip.includes('::')
        ? [...headParts, ...Array(8 - headParts.length - tailParts.length).fill('0'), ...tailParts]
        : headParts;
    return groups.slice(0, 3).map((g) => g.replace(/^0+(?=.)/, '').toLowerCase()).join(':') + '::/48';
}

/** Path used for "top paths": query strings only when the query is the exploit. */
export function probePathKey(url: string, match: ProbeMatch): string {
    const key = QUERY_RULES.has(match.rule) ? url : url.split('?')[0];
    return key.slice(0, 160);
}

/**
 * Pure in-memory aggregator. Distinct paths/sources are capped per UTC day so a
 * scanner spraying random paths can't grow the tables without bound (the caps
 * reset on restart, which at worst allows one extra cap's worth for that day).
 */
export class ProbeAggregator {
    private totals = new Map<string, number>();
    private sources = new Map<string, { sourcePrefix: string | null; count: number }>();
    private paths = new Map<string, number>();
    private samples: ProbeHit[] = [];
    private capDay = '';
    private seenPaths = new Set<string>();
    private seenSources = new Set<string>();

    constructor(private limits = PROBE_LIMITS) {}

    add(hit: ProbeHit): void {
        const day = utcDay(hit.timestamp);
        const { category } = hit.match;
        if (day !== this.capDay) {
            this.capDay = day;
            this.seenPaths.clear();
            this.seenSources.clear();
        }

        const totalKey = `${day}\t${category}`;
        this.totals.set(totalKey, (this.totals.get(totalKey) || 0) + 1);

        let path = probePathKey(hit.url, hit.match);
        if (!this.seenPaths.has(`${category}\t${path}`)) {
            if (this.seenPaths.size >= this.limits.maxPathsPerDay) path = OVERFLOW_PATH;
            else this.seenPaths.add(`${category}\t${path}`);
        }
        const pathKey = `${day}\t${category}\t${path}`;
        this.paths.set(pathKey, (this.paths.get(pathKey) || 0) + 1);

        let sourceHash = hit.sourceHash;
        let sourcePrefix = hit.sourcePrefix;
        if (!this.seenSources.has(`${category}\t${sourceHash}`)) {
            if (this.seenSources.size >= this.limits.maxSourcesPerDay) {
                sourceHash = OVERFLOW_SOURCE;
                sourcePrefix = null;
            } else {
                this.seenSources.add(`${category}\t${sourceHash}`);
            }
        }
        const sourceKey = `${day}\t${category}\t${sourceHash}`;
        const source = this.sources.get(sourceKey);
        if (source) source.count++;
        else this.sources.set(sourceKey, { sourcePrefix, count: 1 });

        this.samples.push(hit);
        if (this.samples.length > this.limits.maxPendingSamples) this.samples.shift();
    }

    get pending(): number {
        return this.totals.size;
    }

    /** Returns everything collected since the last drain and resets the buffers. */
    drain(): ProbeBatch {
        const batch: ProbeBatch = {
            totals: [...this.totals].map(([key, count]) => {
                const [day, category] = key.split('\t');
                return { day, category: category as ProbeCategory, count };
            }),
            sources: [...this.sources].map(([key, value]) => {
                const [day, category, sourceHash] = key.split('\t');
                return { day, category: category as ProbeCategory, sourceHash, ...value };
            }),
            paths: [...this.paths].map(([key, count]) => {
                const [day, category, path] = key.split('\t');
                return { day, category: category as ProbeCategory, path, count };
            }),
            samples: this.samples,
        };
        this.totals = new Map();
        this.sources = new Map();
        this.paths = new Map();
        this.samples = [];
        return batch;
    }
}

// ---------- Recording ----------

const hashSecret = process.env.PROBE_HASH_SECRET || process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

export function hashSource(ip: string | undefined | null): string {
    return crypto.createHmac('sha256', hashSecret).update(ip || 'unknown').digest('hex').slice(0, 16);
}

const aggregator = new ProbeAggregator();
let flushing: Promise<void> | null = null;

async function writeBatch(batch: ProbeBatch): Promise<void> {
    if (!batch.totals.length) return;
    await metricsDbReady;
    await sequelizeMetrics.transaction(async (transaction) => {
        for (const row of batch.totals) {
            await sequelizeMetrics.query(
                `INSERT INTO ProbeDaily (day, category, count) VALUES (:day, :category, :count)
                 ON CONFLICT(day, category) DO UPDATE SET count = count + excluded.count`,
                { replacements: row, transaction },
            );
        }
        for (const row of batch.sources) {
            await sequelizeMetrics.query(
                `INSERT INTO ProbeSourceDaily (day, category, sourceHash, sourcePrefix, count)
                 VALUES (:day, :category, :sourceHash, :sourcePrefix, :count)
                 ON CONFLICT(day, category, sourceHash) DO UPDATE SET count = count + excluded.count`,
                { replacements: row, transaction },
            );
        }
        for (const row of batch.paths) {
            await sequelizeMetrics.query(
                `INSERT INTO ProbePathDaily (day, category, path, count) VALUES (:day, :category, :path, :count)
                 ON CONFLICT(day, category, path) DO UPDATE SET count = count + excluded.count`,
                { replacements: row, transaction },
            );
        }
        if (batch.samples.length) {
            await ProbeSample.bulkCreate(batch.samples.map((s) => ({
                timestamp: s.timestamp,
                category: s.match.category,
                rule: s.match.rule,
                method: s.method,
                url: s.url,
                statusCode: s.statusCode,
                sourceHash: s.sourceHash,
                sourcePrefix: s.sourcePrefix,
                userAgent: s.userAgent,
            })), { transaction });
            await sequelizeMetrics.query(
                'DELETE FROM ProbeSamples WHERE id <= (SELECT MAX(id) FROM ProbeSamples) - :keep',
                { replacements: { keep: PROBE_LIMITS.maxStoredSamples }, transaction },
            );
        }
    });
}

export function flushProbes(): Promise<void> {
    if (flushing) return flushing;
    const batch = aggregator.drain();
    const current = writeBatch(batch)
        .catch((error) => { logger.error('[probes] Failed to write probe batch:', error); })
        .finally(() => { flushing = null; });
    flushing = current;
    return current;
}

const flushTimer = setInterval(() => { void flushProbes(); }, 60_000);
flushTimer.unref();

/**
 * Express middleware: classify cheaply on every request, record on finish.
 * Watch-only — it never blocks or changes the response.
 */
export function trackProbes(req: Request, res: Response, next: NextFunction): void {
    const match = classifyProbe({ method: req.method, url: req.originalUrl, headers: req.headers });
    if (match) {
        res.once('finish', () => {
            aggregator.add({
                match,
                timestamp: new Date(),
                method: req.method.slice(0, 10),
                url: req.originalUrl.slice(0, 300),
                statusCode: res.statusCode,
                sourceHash: hashSource(req.ip),
                sourcePrefix: truncateIp(req.ip),
                userAgent: (req.headers['user-agent'] || '').slice(0, 200) || null,
            });
        });
    }
    next();
}

// ---------- Reporting (admin only) ----------

export type ProbeRange = '7d' | '30d' | '365d';

export function parseProbeRange(value: unknown): ProbeRange {
    return value === '30d' || value === '365d' ? value : '7d';
}

const RANGE_DAYS: Record<ProbeRange, number> = { '7d': 7, '30d': 30, '365d': 365 };

/** One entry per day in the range (oldest first), zero-filled. */
export function buildProbeSeries(
    rows: { day: string; category: string; count: number }[],
    days: number,
    now = new Date(),
): { day: string; total: number; byCategory: Record<string, number> }[] {
    const series = new Map<string, { day: string; total: number; byCategory: Record<string, number> }>();
    for (let i = days - 1; i >= 0; i--) {
        const day = utcDay(new Date(now.getTime() - i * 86_400_000));
        series.set(day, { day, total: 0, byCategory: {} });
    }
    for (const row of rows) {
        const entry = series.get(row.day);
        if (!entry) continue;
        entry.total += Number(row.count);
        entry.byCategory[row.category] = (entry.byCategory[row.category] || 0) + Number(row.count);
    }
    return [...series.values()];
}

export async function getProbeReport(range: ProbeRange) {
    await flushProbes();
    await metricsDbReady;
    const days = RANGE_DAYS[range];
    const detailDays = Math.min(days, PROBE_LIMITS.detailRetentionDays);
    const now = new Date();
    const since = utcDay(new Date(now.getTime() - (days - 1) * 86_400_000));
    const detailSince = utcDay(new Date(now.getTime() - (detailDays - 1) * 86_400_000));
    const select = <T extends object>(sql: string, replacements: Record<string, unknown>) =>
        sequelizeMetrics.query<T>(sql, { replacements, type: QueryTypes.SELECT });

    const [dailyRows, sourceTotals, categorySources, topPaths, topSources, recent] = await Promise.all([
        select<{ day: string; category: string; count: number }>(
            'SELECT day, category, count FROM ProbeDaily WHERE day >= :since', { since }),
        select<{ sources: number }>(
            `SELECT COUNT(DISTINCT sourceHash) AS sources FROM ProbeSourceDaily
             WHERE day >= :detailSince AND sourceHash != :overflow`, { detailSince, overflow: OVERFLOW_SOURCE }),
        select<{ category: string; sources: number }>(
            `SELECT category, COUNT(DISTINCT sourceHash) AS sources FROM ProbeSourceDaily
             WHERE day >= :detailSince AND sourceHash != :overflow GROUP BY category`, { detailSince, overflow: OVERFLOW_SOURCE }),
        select<{ path: string; category: string; count: number; lastDay: string }>(
            `SELECT path, category, SUM(count) AS count, MAX(day) AS lastDay FROM ProbePathDaily
             WHERE day >= :detailSince GROUP BY path, category ORDER BY count DESC LIMIT 15`, { detailSince }),
        select<{ sourceHash: string; sourcePrefix: string | null; count: number; categories: string; firstDay: string; lastDay: string }>(
            `SELECT sourceHash, MAX(sourcePrefix) AS sourcePrefix, SUM(count) AS count,
                    GROUP_CONCAT(DISTINCT category) AS categories, MIN(day) AS firstDay, MAX(day) AS lastDay
             FROM ProbeSourceDaily WHERE day >= :detailSince AND sourceHash != :overflow
             GROUP BY sourceHash ORDER BY count DESC LIMIT 15`, { detailSince, overflow: OVERFLOW_SOURCE }),
        ProbeSample.findAll({ order: [['id', 'DESC']], limit: 50, raw: true }) as Promise<any[]>,
    ]);

    const series = buildProbeSeries(dailyRows, days, now);
    const sourcesByCategory = new Map(categorySources.map((r) => [r.category, Number(r.sources)]));
    const countsByCategory = new Map<string, number>();
    for (const row of dailyRows) countsByCategory.set(row.category, (countsByCategory.get(row.category) || 0) + Number(row.count));

    return {
        range,
        days,
        detailDays,
        generatedAt: now.toISOString(),
        totals: {
            requests: series.reduce((sum, d) => sum + d.total, 0),
            today: series[series.length - 1]?.total ?? 0,
            sources: Number(sourceTotals[0]?.sources ?? 0),
        },
        series,
        categories: (Object.keys(PROBE_CATEGORIES) as ProbeCategory[])
            .map((category) => ({
                category,
                ...PROBE_CATEGORIES[category],
                count: countsByCategory.get(category) || 0,
                sources: sourcesByCategory.get(category) || 0,
            }))
            .sort((a, b) => b.count - a.count),
        topPaths: topPaths.map((r) => ({ ...r, count: Number(r.count) })),
        topSources: topSources.map((r) => ({
            sourceHash: r.sourceHash,
            sourcePrefix: r.sourcePrefix,
            count: Number(r.count),
            categories: (r.categories || '').split(',').filter(Boolean),
            firstDay: r.firstDay,
            lastDay: r.lastDay,
        })),
        recent: recent.map((s) => ({
            timestamp: new Date(s.timestamp).toISOString(),
            category: s.category,
            rule: s.rule,
            method: s.method,
            url: s.url,
            statusCode: s.statusCode,
            sourcePrefix: s.sourcePrefix,
            sourceHash: s.sourceHash,
            userAgent: s.userAgent,
        })),
    };
}
