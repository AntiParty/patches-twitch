import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { Op, QueryTypes } from 'sequelize';
import { Channel, CommandUsage, sequelize } from '@/db';
import { PerformanceMetric, metricsDbReady } from '@/dbMetrics';
import { listOperationalEvents } from './operationalEvents.service';

export type OperationsRange = '24h' | '7d' | '30d' | 'all';

const RANGE_MS: Record<Exclude<OperationsRange, 'all'>, number> = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
};

export function parseOperationsRange(value: unknown): OperationsRange {
    return value === '7d' || value === '30d' || value === 'all' ? value : '24h';
}

export function computeOperationsStatus(input: {
    controlApiReachable: boolean;
    reconnecting: number;
    eventSubHealthy: boolean;
    cacheAgeSeconds: number | null;
}): 'operational' | 'degraded' | 'outage' {
    if (!input.controlApiReachable) return 'outage';
    const cacheFresh = input.cacheAgeSeconds !== null && input.cacheAgeSeconds < 20 * 60;
    return input.reconnecting > 0 || !input.eventSubHealthy || !cacheFresh
        ? 'degraded'
        : 'operational';
}

export function filterActiveCommandRows(
    rows: Array<{ command: string; count: string | number; avgResponseTime: string | number }>,
    activeCommands: Set<string>,
) {
    return rows
        .filter((row) => activeCommands.has(String(row.command).replace(/^!/, '').toLowerCase()))
        .slice(0, 10)
        .map((row) => ({
            command: String(row.command).replace(/^!/, ''),
            count: Number(row.count) || 0,
            avgResponseTimeMs: Math.round(Number(row.avgResponseTime) || 0),
        }));
}

function rangeStart(range: OperationsRange): Date | null {
    return range === 'all' ? null : new Date(Date.now() - RANGE_MS[range]);
}

async function getActiveCommandNames(): Promise<Set<string>> {
    const commandsDir = path.join(process.cwd(), 'src', 'commands');
    const files = await fs.readdir(commandsDir);
    return new Set(files
        .filter((file) => file.endsWith('.ts') || file.endsWith('.js'))
        .map((file) => path.basename(file, path.extname(file)).toLowerCase()));
}

async function readBotApi(pathname: string) {
    try {
        const startedAt = Date.now();
        const response = await axios.get(`http://127.0.0.1:4000${pathname}`, { timeout: 1500 });
        return { reachable: true, latencyMs: Date.now() - startedAt, data: response.data };
    } catch {
        return { reachable: false, latencyMs: null, data: null };
    }
}

async function readCacheAgeSeconds(): Promise<number | null> {
    try {
        const metaPath = path.join(process.cwd(), 'cache', 'meta.json');
        const stat = await fs.stat(metaPath);
        return Math.max(0, Math.round((Date.now() - stat.mtimeMs) / 1000));
    } catch {
        return null;
    }
}

async function getCommandSummary(range: OperationsRange) {
    const start = rangeStart(range);
    const where = start ? { timestamp: { [Op.gte]: start } } : {};
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const activeCommands = await getActiveCommandNames();

    const [allTime, rangedTotal, today, failures, grouped, trend] = await Promise.all([
        CommandUsage.count(),
        CommandUsage.count({ where }),
        CommandUsage.count({ where: { timestamp: { [Op.gte]: startOfToday } } }),
        CommandUsage.count({ where: { ...where, success: false } }),
        CommandUsage.findAll({
            attributes: [
                'command',
                [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
                [sequelize.fn('AVG', sequelize.col('response_time_ms')), 'avgResponseTime'],
            ],
            where,
            group: ['command'] as any,
            order: [[sequelize.literal('count'), 'DESC']],
            raw: true,
        }),
        sequelize.query(
            `SELECT strftime('%Y-%m-%d %H:00:00', timestamp) AS timestamp,
                    COUNT(*) AS commands
             FROM CommandUsage
             WHERE (:start IS NULL OR timestamp >= :start)
             GROUP BY strftime('%Y-%m-%d %H:00:00', timestamp)
             ORDER BY timestamp ASC
             LIMIT 720`,
            {
                replacements: { start: start?.toISOString() || null },
                type: QueryTypes.SELECT,
            },
        ),
    ]);

    return {
        allTime,
        rangedTotal,
        today,
        failures,
        failureRate: rangedTotal > 0 ? Number(((failures / rangedTotal) * 100).toFixed(2)) : 0,
        activeCommands: filterActiveCommandRows(grouped as any[], activeCommands),
        trend: (trend as any[]).map((row) => ({
            timestamp: row.timestamp,
            commands: Number(row.commands) || 0,
        })),
    };
}

export async function getOperationsOverview(range: OperationsRange) {
    await metricsDbReady;
    const [commands, channelCounts, bot, chat, botOperations, cacheAgeSeconds, incidents] = await Promise.all([
        getCommandSummary(range),
        Promise.all([
            Channel.count({ where: { bot_enabled: true, banned: false } }),
            Channel.count({ where: { bot_enabled: true, banned: false, twitch_user_id: { [Op.not]: null } } }),
        ]),
        readBotApi('/health'),
        readBotApi('/metrics/chat?window=21600000&bucket=900000'),
        readBotApi('/metrics/operations'),
        readCacheAgeSeconds(),
        listOperationalEvents(12),
    ]);

    const expected = channelCounts[0];
    const reportedConnected = Number(botOperations.data?.connectedChannels);
    const connected = Number.isFinite(reportedConnected) ? reportedConnected : channelCounts[1];
    const reportedReconnecting = Number(botOperations.data?.reconnectingChannels);
    const reconnecting = Number.isFinite(reportedReconnecting)
        ? reportedReconnecting
        : Math.max(0, expected - connected);
    const eventSubHealthy = bot.data?.checks?.some((check: any) =>
        check.name === 'eventsub_ws' && (check.status === 'ok' || check.status === 'optional'));
    const status = computeOperationsStatus({
        controlApiReachable: bot.reachable,
        reconnecting,
        eventSubHealthy: Boolean(eventSubHealthy),
        cacheAgeSeconds,
    });

    return {
        observedAt: new Date().toISOString(),
        status,
        bot: {
            controlApiReachable: bot.reachable,
            latencyMs: bot.latencyMs,
            uptimeSeconds: Number(bot.data?.uptime) || null,
        },
        channels: { connected, expected, reconnecting },
        commands,
        throughput: Array.isArray(chat.data)
            ? chat.data.map((point: any) => ({
                timestamp: String(point.minute),
                chatIn: Number(point.in) || 0,
                chatOut: Number(point.out) || 0,
            }))
            : [],
        services: { eventSubHealthy: Boolean(eventSubHealthy), cacheAgeSeconds },
        incidents,
    };
}

export async function getBotHealth(range: OperationsRange) {
    await metricsDbReady;
    const start = rangeStart(range) || new Date(0);
    const [overview, performanceHistory] = await Promise.all([
        getOperationsOverview(range),
        PerformanceMetric.findAll({
            attributes: ['timestamp', 'cpuUsage', 'memoryUsed', 'heapUsed', 'botLatencyMs', 'connectedChannels'],
            where: { timestamp: { [Op.gte]: start } },
            order: [['timestamp', 'ASC']],
            limit: 720,
            raw: true,
        }),
    ]);
    return { ...overview, performanceHistory };
}
