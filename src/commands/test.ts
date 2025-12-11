
import logger from '@/util/logger'
export const execcute = async (
    ctx: { say: (msg: string) => Promise<void> },
    channel: string,
    message: string,
    tags: any,
    args: string[]
) => {
    try {
        const username = ctx.tags?.['display-name'] || ctx.user || 'user';
        const messageId = ctx.tags?.['id'];

        if (!username || !messageId) return;
        const testMessage = `Hello ${username}, this is a test message!`;

        await ctx.say(testMessage, messageId);
    } catch (err) {
        logger.error("Error executing test command:", err);
    }
};