import { devModeChannels } from "@/util/ircBot";
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
    message: string,
    args: string[]
) => {
    try {
        if (ctx.user.toLowerCase() !== "antiparty") {
            return;
        }

        const channelName = _channel.replace("#", "").toLowerCase();
        const messageId = ctx.tags?.["id"];

        if (devModeChannels.has(channelName)) {
            devModeChannels.delete(channelName);
            await ctx.say(`[Admin] Dev mode DISABLED. Production bot is now ACTIVE in #${channelName}.`, messageId);
        } else {
            devModeChannels.add(channelName);
            await ctx.say(`[Admin] Dev mode ENABLED. Production bot will now be SILENT in #${channelName}.`, messageId);
        }
    } catch (error) {
        logger.error('[devmode] Error executing devmode command:', error);
    }
}

export const aliases = ['devmode', 'dev'];
