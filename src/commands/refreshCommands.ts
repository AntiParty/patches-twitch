import { botManager } from "@/botManager";
import logger from "@/util/logger";

interface CommandContext {
    say: (message: string, replyParentId?: string) => Promise<void>;
    raw: (line: string) => void;
    user: string;
    channel: string;
    message: string;
    tags?: Record<string, any>;
}

export const execute = async (
    ctx: CommandContext,
    _channel: string,
    _message: string,
    _tags: Record<string, any>,
    _args: string[]
) => {
    try {
        if (ctx.user.toLowerCase() !== "antiparty") {
            return;
        }

        await botManager.reloadCommands();
        await ctx.say(`[Admin] Commands reloaded successfully.`, ctx.tags?.["id"]);
        logger.info(`[refresh] Commands reloaded by ${ctx.user} in ${ctx.channel}`);

    } catch (error) {
        await ctx.say(`[Admin] Failed to reload commands.`, ctx.tags?.["id"]);
        logger.error(`[refresh] Failed to reload commands by ${ctx.user} in ${ctx.channel}`, error);
    }
}

export const aliases = ['refresh', 'reload'];