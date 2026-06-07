import { AdminAuditEvent, OperationalEvent, metricsDbReady } from '@/dbMetrics';
import logger from '@/util/logger';

export type OperationalSeverity = 'info' | 'warning' | 'critical';

export interface OperationalEventInput {
    type: string;
    severity?: OperationalSeverity;
    channel?: string | null;
    durationMs?: number | null;
    attemptCount?: number | null;
    reasonCode?: string | null;
    outcome?: string | null;
}

export interface AdminAuditInput {
    actor: string;
    actorRole: string;
    action: string;
    target?: string | null;
    outcome: string;
}

function cleanIdentifier(value: unknown, maxLength: number): string | null {
    if (value === undefined || value === null) return null;
    const cleaned = String(value)
        .replace(/[^a-zA-Z0-9_#.,:@/ -]/g, '')
        .trim()
        .slice(0, maxLength);
    return cleaned || null;
}

function cleanInteger(value: unknown): number | null {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

export function sanitizeOperationalEvent(input: OperationalEventInput) {
    return {
        type: cleanIdentifier(input.type, 64) || 'unknown',
        severity: ['info', 'warning', 'critical'].includes(String(input.severity))
            ? input.severity
            : 'info',
        channel: cleanIdentifier(input.channel, 100),
        durationMs: cleanInteger(input.durationMs),
        attemptCount: cleanInteger(input.attemptCount),
        reasonCode: cleanIdentifier(input.reasonCode, 80),
        outcome: cleanIdentifier(input.outcome, 24),
        timestamp: new Date(),
    };
}

export function sanitizeAdminAuditEvent(input: AdminAuditInput) {
    return {
        actor: cleanIdentifier(input.actor, 100) || 'unknown',
        actorRole: cleanIdentifier(input.actorRole, 32) || 'unknown',
        action: cleanIdentifier(input.action, 64) || 'unknown',
        target: cleanIdentifier(input.target, 255),
        outcome: cleanIdentifier(input.outcome, 24) || 'unknown',
        timestamp: new Date(),
    };
}

export async function recordOperationalEvent(input: OperationalEventInput): Promise<void> {
    try {
        await metricsDbReady;
        await OperationalEvent.create(sanitizeOperationalEvent(input));
    } catch (error) {
        logger.warn('[Operations] Failed to persist operational event:', error);
    }
}

export async function recordAdminAuditEvent(input: AdminAuditInput): Promise<void> {
    try {
        await metricsDbReady;
        await AdminAuditEvent.create(sanitizeAdminAuditEvent(input));
    } catch (error) {
        logger.warn('[AdminAudit] Failed to persist audit event:', error);
    }
}

export async function listOperationalEvents(limit = 20) {
    await metricsDbReady;
    const rows = await OperationalEvent.findAll({
        attributes: [
            'id',
            'type',
            'severity',
            'channel',
            'durationMs',
            'attemptCount',
            'reasonCode',
            'outcome',
            'timestamp',
        ],
        order: [['timestamp', 'DESC']],
        limit: Math.min(Math.max(limit, 1), 100),
        raw: true,
    });
    return rows;
}

export async function listAdminAuditEvents(limit = 50) {
    await metricsDbReady;
    return AdminAuditEvent.findAll({
        attributes: ['id', 'actor', 'actorRole', 'action', 'target', 'outcome', 'timestamp'],
        order: [['timestamp', 'DESC']],
        limit: Math.min(Math.max(limit, 1), 100),
        raw: true,
    });
}
