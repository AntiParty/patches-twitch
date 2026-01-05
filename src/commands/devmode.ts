import { devModeChannels } from "@/util/ircBot";

interface CommandContext {
  say: (message: string, replyParentId?: string) => Promise<void>; // 👈 updated
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

        if (devModeChannels.has(channelName)) {
            devModeChannels.delete(channelName);
            ctx.say(`[Admin] Dev mode DISABLED. Production bot is now ACTIVE in #${channelName}.`);
        } else {
            devModeChannels.add(channelName);
            // If we are in PROD, we announce we are going silent.
            // If we are in DEV, this message comes from the dev bot, which is fine.
            ctx.say(`[Admin] Dev mode ENABLED. Production bot will now be SILENT in #${channelName}.`);
        }
    } catch (error) {
        console.error('Error executing devmode command:', error);
    }
}