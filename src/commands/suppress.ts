/**
 * !suppress command
 * Allows the broadcaster to toggle bot chat reminders on/off.
 * When suppressed, the bot will not send the "please link your account" reminder
 * when the broadcaster goes live without a linked THE FINALS account.
 *
 * Usage: !suppress
 * Broadcaster-only command.
 */
import { Channel } from '@/db';
import logger from '@/util/logger';

export const execute = async (
  ctx: { say: (msg: string) => Promise<void>; user: string },
  _channel: string,
  _message: string,
  tags: Record<string, any>,
  _args: string[]
): Promise<void> => {
  const displayName = tags?.['display-name'] || ctx.user;

  // Only the broadcaster can toggle their own channel's notifications
  const isBroadcaster =
    tags?.badges?.broadcaster === '1' ||
    ctx.user?.toLowerCase() === _channel.replace('#', '').toLowerCase();

  if (!isBroadcaster) {
    await ctx.say(`@${displayName}, only the broadcaster can use !suppress.`);
    return;
  }

  try {
    const channelName = _channel.replace('#', '');
    const channelInstance = await Channel.findOne({ where: { username: channelName } });

    if (!channelInstance) {
      await ctx.say(`@${displayName}, channel not found.`);
      return;
    }

    const current = channelInstance.get('notify_chat_reminders') !== false;
    const newState = !current;
    await channelInstance.update({ notify_chat_reminders: newState });

    logger.info(`[suppress] ${channelName} toggled notify_chat_reminders → ${newState}`);

    if (newState) {
      await ctx.say(`@${displayName}, bot chat reminders have been re-enabled. ✅`);
    } else {
      await ctx.say(`@${displayName}, bot chat reminders suppressed. Type !suppress again to re-enable.`);
    }
  } catch (err) {
    logger.error(`[suppress] Error toggling notifications for ${_channel}:`, err);
    await ctx.say(`@${displayName}, failed to update notification settings.`);
  }
};
