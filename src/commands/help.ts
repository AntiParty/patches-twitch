export const execute = async (ctx, channel: string, message: string, tags: any, args: string[]) => {
    try {
        const username = tags['display-name'];
        const messageId = tags['id'];

        if (!username || !messageId) return;

        const publicCommands = ['!help','!addaccount','!rank','!record','!unlink'];
        const discordLink = 'https://discord.gg/2UKzvzSEqA';
        const replyMessage = `Available commands: ${publicCommands.join(', ')} | Need help? Join our Discord: ${discordLink}`;

        // Use the `say` helper from ctx (which sends via Helix API)
        await ctx.say(replyMessage);
    } catch (err) {
        console.error('Error executing help command:', err);
    }
};

export const aliases = ['commands', 'info', 'h'];