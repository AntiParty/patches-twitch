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

    it('summarizes live bot vitals from the control API', () => {
        const summary = analytics.summarizeBotLiveStatus({
            health: {
                reachable: true,
                latencyMs: 12,
                data: {
                    uptime: 3600.5,
                    memory: { rss: 200_000_000, heapUsed: 90_000_000 },
                    checks: [
                        { name: 'database', status: 'ok', latencyMs: 3 },
                        { name: 'eventsub_conduit', status: 'degraded', shardsAssigned: 1, shardCount: 2 },
                    ],
                },
            },
            operations: {
                reachable: true,
                latencyMs: 5,
                data: {
                    connectedChannels: 40,
                    reconnectingChannels: 2,
                    conduitShardsAssigned: 1,
                    conduitShardCount: 2,
                    channelsByActiveTransport: { irc: 30, eventsub: 12 },
                    conduitSubscriptionsFailed: 1,
                    conduitReconnects: 4,
                    eventsubFallbacks: 2,
                    chatDispatchErrors: 0,
                    chatSends: { queued: 3, retries: 1, dropped: 0 },
                    commandCooldownHits: 17,
                },
            },
            cacheAgeSeconds: 60,
        });

        assert.equal(summary.status, 'degraded');
        assert.equal(summary.uptimeSeconds, 3600.5);
        assert.equal(summary.rssBytes, 200_000_000);
        assert.equal(summary.heapUsedBytes, 90_000_000);
        assert.equal(summary.connectedChannels, 40);
        assert.equal(summary.reconnectingChannels, 2);
        assert.equal(summary.conduitState, 'partial');
        assert.equal(summary.conduitShardsAssigned, 1);
        assert.equal(summary.ircChannels, 30);
        assert.equal(summary.eventsubChannels, 12);
        assert.equal(summary.eventsubFallbacks, 2);
        assert.equal(summary.chatDispatchErrors, 0);
        assert.equal(summary.chatSendsQueued, 3);
        assert.equal(summary.chatSendRetries, 1);
        assert.equal(summary.chatSendsDropped, 0);
        assert.equal(summary.commandCooldownHits, 17);
        assert.equal(summary.databaseLatencyMs, 3);
    });

    it('reports an outage with no guessed vitals when the bot is unreachable', () => {
        const unreachable = { reachable: false, latencyMs: null, data: null };
        const summary = analytics.summarizeBotLiveStatus({
            health: unreachable,
            operations: unreachable,
            cacheAgeSeconds: null,
        });

        assert.equal(summary.status, 'outage');
        assert.equal(summary.uptimeSeconds, null);
        assert.equal(summary.rssBytes, null);
        assert.equal(summary.connectedChannels, null);
        assert.equal(summary.conduitState, null);
        assert.equal(summary.chatSendsQueued, null);
        assert.equal(summary.commandCooldownHits, null);
    });

    it('maps the conduit health check to a page state', () => {
        assert.equal(analytics.conduitStateFromCheck(undefined), null);
        assert.equal(analytics.conduitStateFromCheck({ status: 'optional' }), 'off');
        assert.equal(analytics.conduitStateFromCheck({ status: 'ok', shardsAssigned: 2 }), 'connected');
        assert.equal(analytics.conduitStateFromCheck({ status: 'degraded', shardsAssigned: 1 }), 'partial');
        assert.equal(analytics.conduitStateFromCheck({ status: 'degraded', shardsAssigned: 0 }), 'down');
    });

    it('stays operational when the conduit is turned off', () => {
        const summary = analytics.summarizeBotLiveStatus({
            health: { reachable: true, latencyMs: 4, data: { checks: [{ name: 'eventsub_conduit', status: 'optional' }] } },
            operations: { reachable: true, latencyMs: 4, data: { connectedChannels: 5, reconnectingChannels: 0 } },
            cacheAgeSeconds: 60,
        });
        assert.equal(summary.status, 'operational');
        assert.equal(summary.conduitState, 'off');
    });
});
