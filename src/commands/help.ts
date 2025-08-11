import { Client, Userstate } from 'tmi.js';

export const execute = async (client: Client, channel: string, message: string, tags: Userstate) => {
    try {
        const username = tags['display-name'];
        const messageId = tags['id'];

        if (!username || !messageId) {
            console.error('Missing username or message ID.');
            return;
        }


            const publicCommands = [
                '!help',
                '!addaccount',
                '!part',
                '!rank',
                '!record',
                '!unlink',
            ];

            const discordLink = 'https://discord.gg/2UKzvzSEqA';
            const replyMessage = `Available commands: ${publicCommands.join(', ')} | Need help or want to report an issue? Join our Discord: ${discordLink}`;

            // send a reply message
            client.raw(`@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :${replyMessage}`);
    } catch (error) {
        console.error('Error executing help command:', error);
    }
};

// Define aliases for this command
export const aliases = ['commands', 'info', 'h'];