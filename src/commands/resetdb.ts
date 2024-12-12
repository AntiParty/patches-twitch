import { Client, Userstate } from 'tmi.js';
import { Channel } from '../db';

export const execute = async (client: Client, channel: string, message: string, tags: Userstate) => {
  try {
    // Only allow the command to be run by your username (ANTIPARTY)
    if (tags['display-name'] !== 'Antiparty') {
      client.say(channel, `@${tags['display-name']}, you do not have permission to run this command.`);
      return;
    }

    // Delete all records in the database
    await Channel.destroy({ where: {} });

    client.say(channel, `@${tags['display-name']}, the database has been reset successfully.`);
  } catch (error) {
    console.error("Error executing command:", error);
    client.say(channel, `@${tags['display-name']}, there was an error executing the command.`);
  }
};
