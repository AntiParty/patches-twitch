import { Client, Userstate } from 'tmi.js';
import { Channel } from '../db';

export const execute = async (client: Client, channel: string, message: string, tags: Userstate) => {
  try {
    const username = tags['display-name'];
    const messageId = tags['id']; // Get the message ID to reply to

    if (!username || !messageId) {
      console.error('Missing username or message ID.');
      return;
    }

    // Only allow the command to be run by your username (ANTIPARTY)
    if (tags['display-name'] !== 'Antiparty') {
      client.say(channel, `@${tags['display-name']}, you do not have permission to run this command.`);
      return;
    }
    const replyMessage = `Database reset initiated. This may take a few seconds...`;
    // Delete all records in the database
    await Channel.destroy({ where: {} });

    client.raw(`@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :${replyMessage}`);
  } catch (error) {
    console.error("Error executing command:", error);
    client.say(channel, `@${tags['display-name']}, there was an error executing the command.`);
  }
};

export const aliases = ['resetdb', 'cleardb', 'clear', 'reset'];