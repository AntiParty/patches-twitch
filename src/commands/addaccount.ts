import { Client, Userstate } from 'tmi.js';
import { Channel } from '../db';

export const execute = async (client: Client, channel: string, message: string, tags: Userstate, args: string[]) => {
  try {
    // Remove the "#" symbol if it exists
    const sanitizedChannel = channel.replace(/^#/, '');

    if (
      tags['display-name'] !== sanitizedChannel &&
      !tags['badges']?.moderator &&  // Check if the user has a moderator badge
      tags['display-name'] !== 'antiparty'  // Check if the user is the streamer (or their display name)
    ) {
      client.say(channel, `@${tags['display-name']}, you do not have permission to run this command.`);
      return;
    }
    // Ensure a player ID is provided
    if (!args || args.length < 1) {
      client.say(channel, `@${tags['display-name']}, please provide a valid player ID.`);
      return;
    }

    const playerId = args[0]; // Assuming the playerId is passed as the first argument
    console.log(`Linking player ID: ${playerId}`);

    // Find the existing channel, or create it if it doesn't exist
    const channelInstance = await Channel.findOne({ where: { username: sanitizedChannel } });

    if (!channelInstance) {
      // If the channel doesn't exist, create a new record
      const newChannel = await Channel.create({
        username: sanitizedChannel,
        player_id: playerId,
      });
      client.say(channel, `@${tags['display-name']}, your account has been successfully linked with player ID: ${playerId}`);
    } else {
      // If the channel exists, update its player_id
      channelInstance.player_id = playerId;
      await channelInstance.save();
      client.say(channel, `@${tags['display-name']}, your account has been successfully linked with player ID: ${playerId}`);
    }
  } catch (error) {
    console.error("Error executing command:", error);
    client.say(channel, `@${tags['display-name']}, there was an error executing the command.`);
  }
};