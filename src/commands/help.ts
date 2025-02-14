import { Client, Userstate } from 'tmi.js';

export const execute = async (client: Client, channel: string, message: string, tags: Userstate) => {
    try {
        const username = tags['display-name'];
        const messageId = tags['id']; // Get the message ID to reply to

        if (!username || !messageId) {
            console.error('Missing username or message ID.');
            return;
        }

        const replyMessage = `Commands: !rank (check rank), !lastmatch (last match stats), !record (overall record), !addaccount <playerID> (link account). Need help? Join our Discord: discord.gg/santaigg`;

        // Send the message using raw Twitch IRC command
        client.raw(`@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :${replyMessage}`);

    } catch (error) {
        console.error('Error executing help command:', error);
    }
};