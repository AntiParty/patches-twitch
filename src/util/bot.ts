import tmi from 'tmi.js';
import { getStreamStatusWithAutoRefresh } from '../util/twitchUtils';
import { loadCommands } from '../handlers/commands'; // Import loadCommands

const commandHandler = loadCommands(); // ✅ Initialize commands
const connectedChannels: { [key: string]: Set<string> } = {};

export const startChatBot = async (username: string) => {
    const sanitizedUsername = username.replace(/^#/, '');

    console.log(`Starting bot for username: ${sanitizedUsername}`);

    if (!connectedChannels[username]) {
        connectedChannels[username] = new Set();
    }

    if (connectedChannels[username].has(sanitizedUsername)) {
        console.log(`Bot is already connected to ${sanitizedUsername}`);
        return;
    }

    try {
        console.log('Fetching stream status...');
        const streamStatus = await getStreamStatusWithAutoRefresh(sanitizedUsername);

        if (!streamStatus) {
            console.error(`Could not fetch stream status for ${sanitizedUsername}`);
            return;
        }

        console.log('Initializing Twitch client...');
        const client = new tmi.Client({
            options: { debug: false },
            channels: [sanitizedUsername],
            identity: {
                username: process.env.TWITCH_BOT_USERNAME,
                password: `oauth:${process.env.TWITCH_BOT_TOKEN}`,
            },
            capabilities: ['twitch.tv/tags'],
        });

        console.log('Connecting to Twitch...');
        await client.connect();
        connectedChannels[username].add(sanitizedUsername);

        

        client.on('message', (channel, tags, message, self) => {
            if (self) return;
            const command = message.trim().toLowerCase().split(' ')[0];
            const args = message.trim().slice(command.length).split(' ').filter(arg => arg.length > 0);

            if (commandHandler[command]) {
                commandHandler[command](client, channel, message, tags, args);
            }
        });

        client.on('connected', (addr, port) => {
            console.log(`Bot connected to ${addr}:${port}`);
        });

        console.log('Bot setup complete.');
    } catch (error) {
        console.error(`Error connecting bot to ${sanitizedUsername}:`, error);
    }
};

export const stopChatBot = async (client: tmi.Client, channel: string,) => {
    try {
        await client.leave(`#${channel}`);
        console.log(`Bot left channel: ${channel}`);
    } catch (error) {
        console.error(`Error leaving channel ${channel}:`, error);
    }
};

export const reconnectChatBot = async (username: string) => {
    if (client) {
        await stopChatBot(username);
        await startChatBot(username);
    }
};