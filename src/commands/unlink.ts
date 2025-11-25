import { Channel } from '@/db';
import { stopChatBot } from '@/util/ircBot';
import logger from '@/util/logger';

interface CommandContext {
  say: (message: string) => Promise<void>;
  raw: (line: string) => void;
  user: string;
  channel: string;
  message: string;
  tags: Record<string, any>;
}

export const execute = async (ctx: CommandContext) => {
  try {
    // make username lowercase for consistency
    const username = ctx.user.toLowerCase();
    if (!username) {
      logger.error('Missing username.');
      return;
    }
    // make username lowercase for consistency
    logger.info(`Attempting to unlink user: ${username}`);

    // Remove the user's channel from the database
    const deleted = await Channel.destroy({ where: { username } });

    if (deleted) {
      logger.info(`User ${username} unlinked from the database.`);

      // Part the bot from the channel
      await stopChatBot(ctx.channel);

      await ctx.say(`@${username}, your account has been unlinked and the bot has left the channel.`);
      logger.info(`Unlinked and parted from ${ctx.channel}`);
    } else {
      logger.info(`User ${username} not found in the database.`);
      await ctx.say(`@${username}, your account is not linked.`);
    }
  } catch (error) {
    logger.error('Error executing unlink command:', error);
    await ctx.say('An error occurred while trying to unlink your account.');
  }
};

export const aliases = ['remove', 'disconnect'];