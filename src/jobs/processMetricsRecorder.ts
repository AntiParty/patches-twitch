/**
 * processMetricsRecorder.ts
 * Writes one PerformanceMetric row per minute describing the bot process itself,
 * for the admin Bot Health and /statistics System charts.
 *
 * Columns (existing schema, so no migration):
 *   cpuUsage          process CPU, % of one core, over the last interval
 *   memoryUsed        process RSS bytes (memoryTotal = machine RAM)
 *   heapUsed/Total    V8 heap bytes
 *   botLatencyMs      mean event-loop delay over the interval, ms
 *   connectedChannels IRC clients currently connected
 * Old rows are pruned after 30 days by the cleanup in dbMetrics.ts.
 */
import os from 'os';
import { monitorEventLoopDelay } from 'perf_hooks';
import { PerformanceMetric, metricsDbReady } from '@/dbMetrics';
import logger from '@/util/logger';

export interface CpuSample {
    /** process.cpuUsage() user + system, microseconds. */
    cpuMicros: number;
    /** Wall clock, ms. */
    atMs: number;
}

/** Process CPU over the interval between two samples, as % of one core. */
export function cpuPercentBetween(prev: CpuSample, curr: CpuSample): number | null {
    const wallMicros = (curr.atMs - prev.atMs) * 1000;
    if (wallMicros <= 0) return null;
    const pct = ((curr.cpuMicros - prev.cpuMicros) / wallMicros) * 100;
    return Math.max(0, Math.round(pct * 10) / 10);
}

/** The event-loop histogram reports nanoseconds; NaN until it has a sample. */
export function nanosToMs(nanos: number): number | null {
    return Number.isFinite(nanos) ? Math.round((nanos / 1e6) * 100) / 100 : null;
}

function readCpu(): CpuSample {
    const { user, system } = process.cpuUsage();
    return { cpuMicros: user + system, atMs: Date.now() };
}

export function startProcessMetricsRecorder(options: {
    getConnectedChannels: () => number;
    intervalMs?: number;
}): () => void {
    const intervalMs = options.intervalMs ?? 60_000;
    const loopDelay = monitorEventLoopDelay({ resolution: 20 });
    loopDelay.enable();
    let lastCpu = readCpu();

    const record = async () => {
        const cpu = readCpu();
        const cpuUsage = cpuPercentBetween(lastCpu, cpu);
        lastCpu = cpu;
        const loopDelayMs = nanosToMs(loopDelay.mean);
        loopDelay.reset();
        const mem = process.memoryUsage();

        try {
            await metricsDbReady;
            await PerformanceMetric.create({
                timestamp: new Date(cpu.atMs),
                cpuUsage: cpuUsage ?? 0,
                loadAvg: JSON.stringify(os.loadavg()),
                memoryTotal: os.totalmem(),
                memoryUsed: mem.rss,
                heapUsed: mem.heapUsed,
                heapTotal: mem.heapTotal,
                botLatencyMs: loopDelayMs,
                connectedChannels: options.getConnectedChannels(),
                extra: null,
            });
        } catch (err: any) {
            logger.warn(`[ProcessMetrics] Failed to record sample: ${err?.message ?? err}`);
        }
    };

    const timer = setInterval(() => { void record(); }, intervalMs);
    timer.unref();

    return () => {
        clearInterval(timer);
        loopDelay.disable();
    };
}
