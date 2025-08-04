import tmi from 'tmi.js';
import { getStreamStatusWithAutoRefresh } from '../util/twitchUtils';
import { loadCommands } from '../handlers/commands'; // Import loadCommands

const commandHandler = loadCommands(); // ✅ Initialize commands
const connectedChannels: { [key: string]: Set<string> } = {};

let client: tmi.Client | null = null;

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
        client = new tmi.Client({
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

        client.on('message', async (channel, tags, message, self) => {
            if (self) return;

            const rawCommand = message.trim().split(' ')[0].toLowerCase();
            const args = message.trim().slice(rawCommand.length).trim().split(/\s+/);

            const commandEntry = commandHandler[rawCommand];
            if (commandEntry?.execute) {
                try {
                    await commandEntry.execute(client!, channel, message, tags, args);
                } catch (err) {
                    console.error(`[${rawCommand}] Error executing command:`, err);
                }
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

export const stopChatBot = async (channel: string) => {
    try {
        if (client) {
            await client.leave(`#${channel}`);
            console.log(`Bot left channel: ${channel}`);
        }
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

export { client };