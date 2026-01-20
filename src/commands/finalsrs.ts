import logger from "@/util/logger";
export const execute = async (
    ctx: { say: (msg: string, replyTo?: string) => Promise<void>, tags?: Record<string, any>, user?: string },
    channel: string,
    message: string,
    tags: any,
) => {
    try {
        const username = ctx.tags?.['display-name'] || ctx.user || 'user';
    const messageId = ctx.tags?.['id'];

    if (!username || !messageId) return;

    const source = channel.replace('#', '');
    const replyMessage = `FinalsRS is a Twitch bot for THE FINALS that tracks live ranks, leaderboard positions, and session progress in chat - https://finalsrs.com/?ref=${source} `
    await ctx.say(replyMessage, messageId);
    } catch (err) {
        logger.error("Error executing finalsrs command:", err);
    }
}

export const aliases = ["finalsrs", "aboutfinalsrs"];