import logger from '@/util/logger'
import { Channel } from '@/db'

export const minRole = "tester";

export const execute = async (
    ctx: { say: (msg: string) => Promise<void>, user: string },
    channelName: string,
    message: string,
    tags: any,
    args: string[]
) => {
    try {
        const sender = ctx.user;
        if (!sender) return;

        // Handle "!role [username]" to view role
        let targetUser = sender;
        if (args.length > 0 && args[0].toLowerCase() !== 'set') {
            targetUser = args[0].toLowerCase().replace('@', '');
        }

        const channelRecord = await Channel.findOne({ where: { username: targetUser } });

        if (channelRecord) {
            const role = channelRecord.role;
            await ctx.say(`@${tags?.['display-name'] || sender} ${targetUser === sender ? 'Your' : targetUser + "'s"} role is: ${role}`);
        } else {
            await ctx.say(`@${tags?.['display-name'] || sender} ${targetUser === sender ? 'You are' : targetUser + ' is'} not registered in the system.`);
        }
    } catch (err) {
        logger.error("Error executing role command:", err);
    }
}

export const aliases = ["role"];