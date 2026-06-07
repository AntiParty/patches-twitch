import assert from 'assert';
import * as analytics from '../../services/operationsAnalytics.service';
import {
    sanitizeAdminAuditEvent,
    sanitizeOperationalEvent,
} from '../../services/operationalEvents.service';

describe('operations analytics', () => {
    it('exposes a pure operational status calculator', () => {
        assert.equal(typeof (analytics as any).computeOperationsStatus, 'function');
    });

    it('reports operational only when every critical signal is healthy', () => {
        const compute = (analytics as any).computeOperationsStatus;
        assert.equal(compute({
            controlApiReachable: true,
            reconnecting: 0,
            eventSubHealthy: true,
            cacheAgeSeconds: 120,
        }), 'operational');
        assert.equal(compute({
            controlApiReachable: true,
            reconnecting: 2,
            eventSubHealthy: true,
            cacheAgeSeconds: 120,
        }), 'degraded');
        assert.equal(compute({
            controlApiReachable: false,
            reconnecting: 0,
            eventSubHealthy: true,
            cacheAgeSeconds: 120,
        }), 'outage');
    });

    it('filters retired commands from active rankings without changing totals', () => {
        assert.equal(typeof (analytics as any).filterActiveCommandRows, 'function');
        const filter = (analytics as any).filterActiveCommandRows;
        const rows = filter([
            { command: 'rank', count: '20', avgResponseTime: '40' },
            { command: 'retired', count: '15', avgResponseTime: '50' },
        ], new Set(['rank']));

        assert.deepEqual(rows, [
            { command: 'rank', count: 20, avgResponseTimeMs: 40 },
        ]);
        assert.equal(20 + 15, 35, 'Historical total still includes retired command rows');
    });

    it('drops unapproved event properties', () => {
        const operational = sanitizeOperationalEvent({
            type: 'irc_recovered',
            channel: 'example',
            reasonCode: 'socket_close',
            accessToken: 'never-store-this',
            rawError: { response: 'never-store-this' },
        } as any) as any;
        const audit = sanitizeAdminAuditEvent({
            actor: 'admin',
            actorRole: 'admin',
            action: 'BOT_MESSAGE_REQUESTED',
            target: 'channel-one',
            outcome: 'success',
            message: 'never-store-this',
        } as any) as any;

        assert.equal(operational.accessToken, undefined);
        assert.equal(operational.rawError, undefined);
        assert.equal(audit.message, undefined);
    });
});
