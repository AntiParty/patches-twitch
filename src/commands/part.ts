import { stopChatBot, clients } from '../util/ircBot';
import logger from '../util/logger';

interface CommandContext {
  say: (message: string) => Promise<void>;
  raw: (line: string) => void;
  user: string;
  channel: string;
  message: string;
  tags?: Record<string, any>; // make tags optional
}

export const execute = async (
  ctx: CommandContext,
  _channel: string,
  _message: string,
  _args: string[]
) => {
  try {
    const username = ctx.tags?.['display-name'] || ctx.user || 'user';
    const sanitizedChannel = ctx.channel.replace(/^#/, '');

    // Permission check: only broadcaster/streamer (channel owner)
    const usernameLower = username.toLowerCase();
    const sanitizedChannelLower = sanitizedChannel.toLowerCase();
    if (usernameLower !== sanitizedChannelLower) {
      await ctx.say(`@${username}, you do not have permission to run this command.`);
      return;
    }

    // Stop the bot for this channel
    if (clients[sanitizedChannel]) {
      await stopChatBot(sanitizedChannel);
      logger.info(`Bot left channel: ${sanitizedChannel}`);
      await ctx.say(`@${username}, the bot has left #${sanitizedChannel}.`);
    } else {
      await ctx.say(`@${username}, the bot is not connected to #${sanitizedChannel}.`);
    }
  } catch (error) {
    logger.error('Error executing leave command:', error);
    const displayName = ctx.tags?.['display-name'] || ctx.user || 'user';
    await ctx.say(`@${displayName}, there was an error executing the command.`);
  }
};

export const aliases = ['leave'];