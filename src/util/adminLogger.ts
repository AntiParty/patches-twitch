import axios from 'axios';
import logger from './logger';
import {
    recordAdminAuditEvent,
    sanitizeAdminAuditEvent,
} from '@/services/operationalEvents.service';

const ADMIN_LOG_WEBHOOK = process.env.ADMIN_LOG_WEBHOOK;

export async function logAdminAction(
    username: string,
    role: string,
    action: string,
    details: { target?: string | null; outcome?: string } = {},
) {
    const event = sanitizeAdminAuditEvent({
        actor: username,
        actorRole: role,
        action,
        target: details.target,
        outcome: details.outcome || 'success',
    });

    logger.info(`[AdminAction] ${event.actor} (${event.actorRole}): ${event.action}`);
    await recordAdminAuditEvent(event);

    if (!ADMIN_LOG_WEBHOOK) return;
    try {
        await axios.post(ADMIN_LOG_WEBHOOK, {
            content: `[${event.actorRole.toUpperCase()}] **${event.actor}** performed \`${event.action}\`${event.target ? ` on \`${event.target}\`` : ''} (${event.outcome})`,
            username: 'Admin Action Logger',
        }, { timeout: 5000 });
    } catch (error: any) {
        logger.error('Failed to send admin action to Discord:', error?.message || 'request failed');
    }
}
