import { Client, Userstate } from 'tmi.js';
import { Channel } from '../db';
import logger from '../util/logger';

export const execute = async (
  client: Client,
  channel: string,
  message: string,
  tags: Userstate,
  args: string[]
) => {
  try {
    const sanitizedChannel = channel.replace(/^#/, '');
    const username = tags['display-name'];
    const messageId = tags['id'];

    if (!username || !messageId) {
      logger.error('Missing username or message ID.');
      return;
    }

    // Case-insensitive permission check
    const usernameLower = username.toLowerCase();
    const sanitizedChannelLower = sanitizedChannel.toLowerCase();

    if (
      usernameLower !== sanitizedChannelLower &&
      !tags['badges']?.moderator &&
      usernameLower !== 'antiparty'
    ) {
      client.raw(
        `@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, you do not have permission to run this command.`
      );
      return;
    }

    if (!args || args.length < 1) {
      client.raw(
        `@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, please provide a valid player ID.`
      );
      return;
    }

    const playerId = args[0];
    logger.info(`Linking player ID: ${playerId}`);

    let channelInstance = await Channel.findOne({ where: { username: sanitizedChannel } });

    if (!channelInstance) {
      await Channel.create({ username: sanitizedChannel, player_id: playerId });
      client.raw(
        `@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, your account has been successfully linked with player ID: ${playerId}`
      );
    } else {
      channelInstance.player_id = playerId;
      await channelInstance.save();
      client.raw(
        `@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, your account has been successfully linked with player ID: ${playerId}`
      );
    }
  } catch (error) {
    logger.error('Error executing command:', error);
    client.raw(
      `@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, there was an error executing the command.`
    );
  }
};

export const aliases = ['addaccount', 'linkaccount', 'link', 'add'];