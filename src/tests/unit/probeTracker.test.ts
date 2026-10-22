import assert from 'assert';
import {
    ProbeAggregator,
    ProbeHit,
    buildProbeSeries,
    hashSource,
    parseProbeRange,
    probePathKey,
    truncateIp,
} from '../../services/probeTracker.service';
import { ProbeMatch } from '../../util/probeClassifier';

function hit(url: string, match: ProbeMatch, source = 'a', at = '2026-10-22T10:00:00Z'): ProbeHit {
    return {
        match,
        timestamp: new Date(at),
        method: 'GET',
        url,
        statusCode: 404,
        sourceHash: source,
        sourcePrefix: `${source}.x`,
        userAgent: null,
    };
}

const php: ProbeMatch = { category: 'php-other', rule: 'php-extension' };
const cgi: ProbeMatch = { category: 'php-cgi-injection', rule: 'cgi-dash-arg' };

describe('probe tracker', () => {
    describe('truncateIp', () => {
        it('keeps the IPv4 /24', () => assert.equal(truncateIp('203.0.113.42'), '203.0.113.x'));
        it('unwraps IPv4-mapped IPv6', () => assert.equal(truncateIp('::ffff:198.51.100.7'), '198.51.100.x'));
        it('keeps the IPv6 /48', () => {
            assert.equal(truncateIp('2001:db8:abcd:12:1:2:3:4'), '2001:db8:abcd::/48');
            assert.equal(truncateIp('2001:db8::1'), '2001:db8:0::/48');
            assert.equal(truncateIp('::1'), 'localhost');
            assert.equal(truncateIp('::ffff:127.0.0.1'), 'localhost');
        });
        it('returns null for junk', () => {
            assert.equal(truncateIp(undefined), null);
            assert.equal(truncateIp('unknown'), null);
        });
    });

    it('hashes sources to a stable 16-char key that is not the IP', () => {
        const h = hashSource('203.0.113.42');
        assert.equal(h.length, 16);
        assert.equal(h, hashSource('203.0.113.42'));
        assert.notEqual(h, hashSource('203.0.113.43'));
        assert.ok(!h.includes('203'));
    });

    it('keeps the query string only for query-based exploits', () => {
        assert.equal(probePathKey('/index.php?cache=123', php), '/index.php');
        assert.equal(probePathKey('/?-d+allow_url_include=1', cgi), '/?-d+allow_url_include=1');
        assert.equal(probePathKey('/' + 'a'.repeat(400), php).length, 160);
    });

    it('aggregates totals, sources and paths per day and category', () => {
        const agg = new ProbeAggregator();
        agg.add(hit('/a.php', php, 's1'));
        agg.add(hit('/a.php', php, 's1'));
        agg.add(hit('/b.php', php, 's2'));
        agg.add(hit('/?-s', cgi, 's1'));
        agg.add(hit('/a.php', php, 's1', '2026-10-23T00:00:01Z'));
        const batch = agg.drain();

        const total = (day: string, category: string) =>
            batch.totals.find((t) => t.day === day && t.category === category)?.count;
        assert.equal(total('2026-10-22', 'php-other'), 3);
        assert.equal(total('2026-10-22', 'php-cgi-injection'), 1);
        assert.equal(total('2026-10-23', 'php-other'), 1);

        const s1 = batch.sources.find((s) => s.day === '2026-10-22' && s.category === 'php-other' && s.sourceHash === 's1');
        assert.equal(s1?.count, 2);
        assert.equal(s1?.sourcePrefix, 's1.x');
        assert.equal(batch.paths.find((p) => p.day === '2026-10-22' && p.path === '/a.php')?.count, 2);
        assert.equal(batch.samples.length, 5);

        assert.deepEqual(agg.drain().totals, [], 'drain resets the buffers');
    });

    it('caps distinct paths, sources and pending samples', () => {
        const agg = new ProbeAggregator({
            maxPathsPerDay: 2,
            maxSourcesPerDay: 2,
            maxPendingSamples: 3,
            maxStoredSamples: 10,
            detailRetentionDays: 30,
            totalsRetentionDays: 365,
        });
        for (let i = 0; i < 6; i++) agg.add(hit(`/p${i}.php`, php, `s${i}`));
        agg.add(hit('/p0.php', php, 's0')); // already-seen keys are not overflowed
        const batch = agg.drain();

        assert.equal(batch.totals[0].count, 7);
        assert.deepEqual(batch.paths.map((p) => [p.path, p.count]).sort(), [
            ['(other paths)', 4], ['/p0.php', 2], ['/p1.php', 1],
        ]);
        const overflow = batch.sources.find((s) => s.sourceHash === 'overflow');
        assert.equal(overflow?.count, 4);
        assert.equal(overflow?.sourcePrefix, null);
        assert.equal(batch.samples.length, 3);
        assert.equal(batch.samples[2].url, '/p0.php', 'keeps the most recent samples');
    });

    it('builds a zero-filled daily series', () => {
        const series = buildProbeSeries([
            { day: '2026-10-22', category: 'php-other', count: 3 },
            { day: '2026-10-22', category: 'wordpress', count: 2 },
            { day: '2026-10-20', category: 'php-other', count: 1 },
            { day: '2026-09-01', category: 'php-other', count: 99 },
        ], 3, new Date('2026-10-22T12:00:00Z'));
        assert.deepEqual(series.map((d) => [d.day, d.total]), [
            ['2026-10-20', 1], ['2026-10-21', 0], ['2026-10-22', 5],
        ]);
        assert.deepEqual(series[2].byCategory, { 'php-other': 3, wordpress: 2 });
    });

    it('defaults unknown ranges to 7d', () => {
        assert.equal(parseProbeRange('30d'), '30d');
        assert.equal(parseProbeRange('365d'), '365d');
        assert.equal(parseProbeRange('all'), '7d');
        assert.equal(parseProbeRange(undefined), '7d');
    });
});
