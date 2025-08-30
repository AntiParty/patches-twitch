import { Channel } from '../db';
import logger from '../util/logger';

interface CommandContext {
  say: (message: string) => Promise<void>;
  raw: (line: string) => void;
  user: string;
  channel: string;
  message: string;
  tags?: Record<string, any>; // optional tags
}

export const execute = async (
  ctx: CommandContext,
  _channel: string,
  _message: string,
  args: string[]
) => {
  try {
    // Fallback to ctx.user if tags or display-name is missing
    const username = ctx.tags?.['display-name'] || ctx.user || 'user';
    const sanitizedChannel = ctx.channel.replace(/^#/, '');

    // Permission check
    const usernameLower = username.toLowerCase();
    const sanitizedChannelLower = sanitizedChannel.toLowerCase();
    if (
      usernameLower !== sanitizedChannelLower &&
      !ctx.tags?.['badges']?.moderator &&
      usernameLower !== 'antiparty'
    ) {
      await ctx.say(`@${username}, you do not have permission to run this command.`);
      return;
    }

    if (!args || args.length < 1) {
      await ctx.say(`@${username}, please provide a valid player ID.`);
      return;
    }

    const playerId = args[0];
    logger.info(`Linking player ID: ${playerId}`);

    let channelInstance = await Channel.findOne({ where: { username: sanitizedChannel } });

    if (!channelInstance) {
      try {
        await Channel.create({ username: sanitizedChannel, player_id: playerId });
        await ctx.say(`@${username}, your account has been successfully linked with player ID: ${playerId}`);
      } catch (err: any) {
        if (err.name === 'SequelizeUniqueConstraintError') {
          await ctx.say(`@${username}, this channel is already registered.`);
        } else {
          logger.error('Error creating channel:', err);
          await ctx.say(`@${username}, there was an error linking your account.`);
        }
      }
    } else {
      (channelInstance as any).player_id = playerId;
      await channelInstance.save();
      await ctx.say(`@${username}, your account has been successfully linked with player ID: ${playerId}`);
    }
  } catch (error) {
    logger.error('Error executing command:', error);
    const displayName = ctx.tags?.['display-name'] || ctx.user || 'user';
    await ctx.say(`@${displayName}, there was an error executing the command.`);
  }
};

// Command aliases
export const aliases = ['addaccount', 'linkaccount', 'link', 'add'];