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

// Second-step confirmation state. Map of channel -> expiry timestamp (ms).
// Requires `!devmode confirm` within 30s of the initial `!devmode`.
const pendingToggle: Map<string, number> = new Map();
const CONFIRM_WINDOW_MS = 30_000;

export const execute = async (
    ctx: CommandContext,
    _channel: string,
    message: string,
    tags: Record<string, any>,
    args: string[]
) => {
    try {
        // Gate kept to antiparty; minRole isn't granular enough for this.
        if (ctx.user.toLowerCase() !== "antiparty") {
            return;
        }

        const channelName = _channel.replace("#", "").toLowerCase();
        const messageId = ctx.tags?.["id"];
        const sub = (args?.[0] || "").toLowerCase();

        // `!devmode status` always works without confirmation.
        if (sub === "status") {
            const on = devModeChannels.has(channelName);
            await ctx.say(
                `[Admin] Dev mode is currently ${on ? "ON (bot silent)" : "OFF (bot active)"} in #${channelName}.`,
                messageId
            );
            return;
        }

        // Confirmation step for the toggle to prevent accidental silencing.
        // Fix for issue #3 / #15: no more one-keystroke muting of the whole bot.
        const pendingExpiry = pendingToggle.get(channelName) || 0;
        const pendingValid = pendingExpiry > Date.now();

        if (sub !== "confirm" && !pendingValid) {
            const nextState = devModeChannels.has(channelName) ? "OFF (bot will talk again)" : "ON (bot goes silent)";
            pendingToggle.set(channelName, Date.now() + CONFIRM_WINDOW_MS);
            await ctx.say(
                `[Admin] About to toggle dev mode ${nextState} in #${channelName}. Reply !devmode confirm within 30s to apply, or ignore to cancel.`,
                messageId
            );
            return;
        }

        // We have a valid pending toggle (or `confirm` sub-arg). Apply it.
        pendingToggle.delete(channelName);

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
                `🔇 [Admin] Dev mode ENABLED. Production bot will stay SILENT in #${channelName} until a matching dev bot handles commands. Run !devmode again to undo.`,
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
