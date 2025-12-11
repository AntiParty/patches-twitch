import { logger } from '@/util/logger'
export const execute = async (
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


        const publicCommands = [
            "!help",
            "!addaccount",
            "!rank",
            "!record",
            "!unlink",
        ];


        const discordLink = "https://discord.gg/2UKzvzSEqA";


        const replyMessage = `Link your Finals account with !link | 📜 Commands: ${publicCommands.join(
            ", "
        )} | 💬 Help: ${discordLink}`;
        await ctx.say(replyMessage, messageId);
    } catch (err) {
        logger.error("Error executing help command:", err);
    }
};

// Aliases for this command
export const aliases = ["info", "h", "cmds", "cmd"];