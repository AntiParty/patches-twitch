import { purgeChannelData } from '@/services/channelDataPurge.service';
import { broadcasterIdFor, stopChat } from '@/chat/chatPresence';
import { getConduitRuntime } from '@/eventsub/conduitRuntime';
import { Channel } from '@/db';
import logger from '@/util/logger';

interface CommandContext {
  say: (message: string, replyParentId?: string) => Promise<void>;
  raw: (line: string) => void;
  user: string;
  channel: string;
  message: string;
  tags: Record<string, any>;
}

/** True when the sender is the broadcaster of the channel the command ran in. */
export function isChannelBroadcaster(sender: string | undefined, channel: string): boolean {
  const senderLower = (sender || '').toLowerCase();
  const channelLower = (channel || '').replace(/^#/, '').toLowerCase();
  return !!senderLower && senderLower === channelLower;
}

export const execute = async (ctx: CommandContext) => {
  const messageId = ctx.tags?.['id'];
  try {
    const sanitizedChannel = ctx.channel.replace(/^#/, '').toLowerCase();
    const username = ctx.user.toLowerCase();

    if (!isChannelBroadcaster(ctx.user, ctx.channel)) {
      await ctx.say(`@${username}, only the broadcaster can unlink this channel.`, messageId);
      return;
    }

    logger.info(`Attempting to unlink channel: ${sanitizedChannel}`);

    // The purge deletes the row, so capture the broadcaster id for the conduit cleanup first.
    const row: any = await Channel.findOne({ where: { username: sanitizedChannel } });
    const broadcasterId = String(row?.twitch_user_id || broadcasterIdFor(sanitizedChannel) || '');

    // Remove the channel and all of its data from the database
    const deleted = await purgeChannelData(sanitizedChannel);

    if (deleted) {
      logger.info(`Channel ${sanitizedChannel} unlinked from the database.`);

      // Reply first: stopChat tears down the connection for this channel
      await ctx.say(`@${username}, your account has been unlinked and the bot has left the channel.`, messageId);

      // Part the bot from the channel
      await stopChat(sanitizedChannel);
      // Chat is gone; drop the stream and redemption subscriptions too, so a later re-link starts clean.
      const registry = getConduitRuntime()?.registry;
      if (registry && broadcasterId) await registry.removeChannel(broadcasterId);
      logger.info(`Unlinked and parted from ${sanitizedChannel}`);
    } else {
      logger.info(`Channel ${sanitizedChannel} not found in the database.`);
      await ctx.say(`@${username}, your account is not linked.`, messageId);
    }
  } catch (error) {
    logger.error('Error executing unlink command:', error);
    await ctx.say('An error occurred while trying to unlink your account.', messageId);
  }
};

export const aliases = ['remove', 'disconnect'];
