import logger from "@/util/logger";
export const execute = async (
    ctx: { say: (msg: string) => Promise<void> },
    channel: string,
    message: string,
    tags: any,
) => {
    try {
        const username = ctx.tags?.['display-name'] || ctx.user || 'user';
    const messageId = ctx.tags?.['id'];

    if (!username || !messageId) return;

    const replyMessage = `FinalsRS is a Twitch bot for THE FINALS that tracks live 
    ranks, leaderboard positions, and session progress in chat - https://finalsrs.com/ `
    await ctx.say(replyMessage, messageId);
    } catch (err) {
        logger.error("Error executing finalsrs command:", err);
    }
}

export const aliases = ["finalsrs", "aboutfinalsrs"];