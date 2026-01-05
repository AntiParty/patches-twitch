import { devModeChannels } from "../util/ircBot";

export const execute = async (
  ctx: any,
  channel: string,
  message: string,
  tags: Record<string, any>,
  args: string[]
) => {
  // Only allow 'antiparty' to use this command
  if (ctx.user.toLowerCase() !== "antiparty") {
    return;
  }

  // Sanitize channel name
  const channelName = channel.replace("#", "").toLowerCase();

  if (devModeChannels.has(channelName)) {
    devModeChannels.delete(channelName);
    ctx.say(`[Admin] Dev mode DISABLED. Production bot is now ACTIVE in #${channelName}.`);
  } else {
    devModeChannels.add(channelName);
    // If we are in PROD, we announce we are going silent.
    // If we are in DEV, this message comes from the dev bot, which is fine.
    ctx.say(`[Admin] Dev mode ENABLED. Production bot will now be SILENT in #${channelName}.`);
  }
};
