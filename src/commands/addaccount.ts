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

      if (!username) {
        logger.error('Missing username.');
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
      client.say(channel, `@${username}, you do not have permission to run this command.`);
      return;
    }

    if (!args || args.length < 1) {
      client.say(channel, `@${username}, please provide a valid player ID.`);
      return;
    }

    const playerId = args[0];
    logger.info(`Linking player ID: ${playerId}`);

    let channelInstance = await Channel.findOne({ where: { username: sanitizedChannel } });

      if (!channelInstance) {
        try {
          await Channel.create({ username: sanitizedChannel, player_id: playerId });
          client.say(channel, `@${username}, your account has been successfully linked with player ID: ${playerId}`);
        } catch (err: any) {
          if (err.name === 'SequelizeUniqueConstraintError') {
            client.say(channel, `@${username}, this channel is already registered.`);
          } else {
            logger.error('Error creating channel:', err);
            client.say(channel, `@${username}, there was an error linking your account.`);
          }
        }
      } else {
    (channelInstance as any).player_id = playerId;
    await channelInstance.save();
    client.say(channel, `@${username}, your account has been successfully linked with player ID: ${playerId}`);
      }
  } catch (error) {
    logger.error('Error executing command:', error);
    const displayName = tags['display-name'] || 'user';
    client.say(channel, `@${displayName}, there was an error executing the command.`);
  }
};

export const aliases = ['addaccount', 'linkaccount', 'link', 'add'];