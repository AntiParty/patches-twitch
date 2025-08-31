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

        // Define public commands
        const publicCommands = [
            "!help",
            "!addaccount",
            "!rank",
            "!record",
            "!unlink",
        ];

        // Discord invite link
        const discordLink = "https://discord.gg/2UKzvzSEqA";

        // Reply message
        const replyMessage = `Link your Finals account with !link | 📜 Commands: ${publicCommands.join(
            ", "
        )} | 💬 Help: ${discordLink}`;
        await ctx.say(replyMessage, messageId);
    } catch (err) {
        console.error("Error executing help command:", err);
    }
};

// Aliases for this command
export const aliases = ["commands", "info", "h"];