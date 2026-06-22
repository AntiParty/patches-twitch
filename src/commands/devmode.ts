import { devModeChannels } from "@/util/devModeState";
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
    tags: Record<string, any>,
    args: string[]
) => {
    try {
        // Owner-only. minRole isn't granular enough for a single account.
        if (ctx.user.toLowerCase() !== "antiparty") {
            return;
        }

        const channelName = _channel.replace("#", "").toLowerCase();
        const messageId = ctx.tags?.["id"];
        const sub = (args?.[0] || "").toLowerCase();

        // `!devmode status` reports state without changing it.
        if (sub === "status") {
            const on = devModeChannels.has(channelName);
            await ctx.say(
                `[Admin] Dev mode is currently ${on ? "ON (bot silent)" : "OFF (bot active)"} in #${channelName}.`,
                messageId
            );
            return;
        }

        // One-step toggle. Owner-gated, so there's no accidental-mute risk that
        // would warrant a confirmation step.
        if (devModeChannels.has(channelName)) {
            devModeChannels.delete(channelName);
            logger.warn(`[devmode] Dev mode DISABLED for #${channelName} by ${ctx.user}`);
            await ctx.say(
                `✅ [Admin] Dev mode DISABLED. Production bot is now ACTIVE in #${channelName}. All commands respond normally.`,
                messageId
            );
        } else {
            devModeChannels.add(channelName);
            logger.warn(`[devmode] Dev mode ENABLED for #${channelName} by ${ctx.user}`);
            await ctx.say(
                `🔇 [Admin] Dev mode ENABLED — bot is now SILENT in #${channelName} (all commands suppressed). Run !devmode again to unmute.`,
                messageId
            );
        }
    } catch (error) {
        logger.error('[devmode] Error executing devmode command:', error);
    }
}

/**
 * Read-only accessor so dashboard routes can render the current devmode
 * state without importing internals of ircBot.
 */
export function getDevModeChannels(): string[] {
    return Array.from(devModeChannels);
}

export const aliases = ['devmode', 'dev'];
