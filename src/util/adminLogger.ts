import axios from 'axios';
import logger from './logger';

const ADMIN_LOG_WEBHOOK = process.env.ADMIN_LOG_WEBHOOK;

export async function logAdminAction(username: string, role: string, action: string, details?: any) {
    const message = `[${role.toUpperCase()}] **${username}** performed: \`${action}\`${details ? `\nDetails: \`\`\`json\n${JSON.stringify(details, null, 2)}\n\`\`\`` : ''}`;
    
    // Log locally
    logger.info(`[AdminAction] ${username} (${role}): ${action}`);

    // Log to Discord
    if (ADMIN_LOG_WEBHOOK) {
        try {
            await axios.post(ADMIN_LOG_WEBHOOK, {
                content: message,
                username: 'Admin Action Logger',
                avatar_url: 'https://github.com/fluidicon.png'
            });
        } catch (err: any) {
            logger.error('Failed to send admin action to Discord:', err.message);
        }
    }
}
