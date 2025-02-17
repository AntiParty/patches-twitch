import { Client, Userstate } from 'tmi.js';
import { Channel } from '../db';
import { stopChatBot } from '../util/bot';

export const execute = async (client: Client, channel: string, message: string, tags: Userstate) => {
    try {
        const username = tags['display-name']?.toLowerCase(); // Ensure lowercase for consistency

        if (!username) {
            console.error('Missing username.');
            return;
        }

        console.log(`Attempting to unlink user: ${username}`);

        // Remove the user's tokens and channel from the database
        const deleted = await Channel.destroy({ where: { username } });

        if (deleted) {
            console.log(`User ${username} unlinked from the database.`);
            // Part the bot from the channel
            await stopChatBot(client, channel);
            client.say(channel, `@${username}, your account has been unlinked and the bot has left the channel.`);
            console.log(`Unlinked and parted from ${channel}`);
        } else {
            console.log(`User ${username} not found in the database.`);
            client.say(channel, `@${username}, your account is not linked.`);
        }
    } catch (error) {
        console.error('Error executing unlink command:', error);
        client.say(channel, 'An error occurred while trying to unlink your account.');
    }
};

// Optional: Add aliases for the command
export const aliases = ['remove', 'disconnect'];