import assert from 'assert';
import { cpuPercentBetween, nanosToMs } from '../../jobs/processMetricsRecorder';
import {
    perfBucketSeconds,
    toPerformancePoints,
    toSqliteTimestamp,
} from '../../services/operationsAnalytics.service';

describe('process metrics recorder', () => {
    it('reports process CPU as % of one core over the interval', () => {
        // 30s of CPU time across a 60s wall interval = half a core.
        assert.equal(cpuPercentBetween({ cpuMicros: 0, atMs: 0 }, { cpuMicros: 30_000_000, atMs: 60_000 }), 50);
        // Multi-threaded work can exceed one core.
        assert.equal(cpuPercentBetween({ cpuMicros: 0, atMs: 0 }, { cpuMicros: 90_000_000, atMs: 60_000 }), 150);
    });

    it('refuses a zero-length interval instead of dividing by zero', () => {
        assert.equal(cpuPercentBetween({ cpuMicros: 0, atMs: 1000 }, { cpuMicros: 10, atMs: 1000 }), null);
    });

    it('converts event-loop delay from nanoseconds and ignores an empty histogram', () => {
        assert.equal(nanosToMs(12_345_678), 12.35);
        assert.equal(nanosToMs(NaN), null);
    });
});

describe('performance history buckets', () => {
    it('keeps every range near 300 points', () => {
        assert.equal((24 * 3600) / perfBucketSeconds('24h'), 288);
        assert.equal((7 * 24 * 3600) / perfBucketSeconds('7d'), 336);
        assert.equal((30 * 24 * 3600) / perfBucketSeconds('30d'), 360);
        assert.equal(perfBucketSeconds('all'), perfBucketSeconds('30d'));
    });

    it('formats range starts the way Sequelize stores SQLite dates', () => {
        assert.equal(toSqliteTimestamp(new Date('2026-05-29T11:48:23.169Z')), '2026-05-29 11:48:23.169 +00:00');
    });

    it('maps aggregate rows to chart points without inventing values', () => {
        const [point] = toPerformancePoints([
            { bucket: 1_780_055_100, cpuUsage: 4.5, memoryUsed: '209715200', heapUsed: null, botLatencyMs: 1.2, connectedChannels: 41.6 },
        ]);
        assert.deepEqual(point, {
            timestamp: '2026-05-29T11:45:00.000Z',
            cpuUsage: 4.5,
            memoryUsed: 209_715_200,
            heapUsed: null,
            botLatencyMs: 1.2,
            connectedChannels: 42,
        });
    });
});
