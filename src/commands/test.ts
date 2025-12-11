
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
        const replyMessage = `This is a test command, ${username}!`;
        await ctx.say(replyMessage, messageId);
    } catch (err) {
        logger.error("Error executing test command:", err);
    }
};

// Aliases for this command
export const aliases = ["tst", "testing"];