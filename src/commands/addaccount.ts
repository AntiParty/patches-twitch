import { Client, Userstate } from 'tmi.js';
import { Channel } from '../db';

export const execute = async (client: Client, channel: string, message: string, tags: Userstate, args: string[]) => {
  try {
    const sanitizedChannel = channel.replace(/^#/, '');
    const username = tags['display-name'];
    const messageId = tags['id']; // Get the message ID for replying

    if (!username || !messageId) {
      console.error('Missing username or message ID.');
      return;
    }

    // Permission check
    if (
      username !== sanitizedChannel &&
      !tags['badges']?.moderator &&  
      username !== 'antiparty'
    ) {
      client.raw(`@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, you do not have permission to run this command.`);
      return;
    }

    // Ensure a player ID is provided
    if (!args || args.length < 1) {
      client.raw(`@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, please provide a valid player ID.`);
      return;
    }

    const playerId = args[0]; 
    console.log(`Linking player ID: ${playerId}`);

    // Find or create the channel in the database
    const channelInstance = await Channel.findOne({ where: { username: sanitizedChannel } });

    if (!channelInstance) {
      // Create a new channel entry if none exists
      await Channel.create({ username: sanitizedChannel, player_id: playerId });
      client.raw(`@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, your account has been successfully linked with player ID: ${playerId}`);
    } else {
      // Update the existing player_id
      channelInstance.player_id = playerId;
      await channelInstance.save();
      client.raw(`@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, your account has been successfully linked with player ID: ${playerId}`);
    }
  } catch (error) {
    console.error("Error executing command:", error);
    client.raw(`@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, there was an error executing the command.`);
  }
};

export const aliases = ['addaccount', 'linkaccount', 'link', 'add'];