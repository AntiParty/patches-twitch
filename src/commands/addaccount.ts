import { Channel } from '../db';
import logger from '../util/logger';

interface CommandContext {
  say: (message: string, replyParentId?: string) => Promise<void>; // 👈 updated
  raw: (line: string) => void;
  user: string;
  channel: string;
  message: string;
  tags?: Record<string, any>;
}

// Helper function for threaded replies
async function sendReply(ctx: CommandContext, message: string) {
  const username = ctx.tags?.['display-name'] || ctx.user || 'user';
  const messageId = ctx.tags?.['id'];
  
  if (messageId) {
    // Use Twitch's reply feature properly
    return ctx.say(`@${username}, ${message}`, messageId);
  } else {
    // Fallback without threading
    return ctx.say(`@${username}, ${message}`);
  }
}

export const execute = async (
  ctx: CommandContext,
  _channel: string,
  message: string,
  args: string[]
) => {
  try {
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
      await sendReply(ctx, 'you do not have permission to run this command.');
      return;
    }

    // Extract player ID from the full message
    const messageParts = message.trim().split(/\s+/);
    if (messageParts.length < 2) {
      await sendReply(ctx, 'please provide a valid player ID. Usage: !link <playerID>');
      return;
    }

    const playerId = messageParts.slice(1).join(' ').trim();
    if (!playerId) {
      await sendReply(ctx, 'please provide a valid player ID. Usage: !link <playerID>');
      return;
    }

    logger.info(`Linking player ID: ${playerId} for channel: ${sanitizedChannel}`);

    let channelInstance = await Channel.findOne({ where: { username: sanitizedChannel } });

    if (!channelInstance) {
      try {
        await Channel.create({ username: sanitizedChannel, player_id: playerId });
        await sendReply(ctx, `your account has been successfully linked with player ID: ${playerId}`);
      } catch (err: any) {
        if (err.name === 'SequelizeUniqueConstraintError') {
          await sendReply(ctx, 'this channel is already registered.');
        } else {
          logger.error('Error creating channel:', err);
          await sendReply(ctx, 'there was an error linking your account.');
        }
      }
    } else {
      await channelInstance.update({ player_id: playerId });
      await sendReply(ctx, `your account has been successfully linked with player ID: ${playerId}`);
    }
  } catch (error) {
    logger.error('Error executing command:', error);
    await sendReply(ctx, 'there was an error executing the command.');
  }
};

// Command aliases
export const aliases = ['addaccount', 'linkaccount', 'link', 'add'];