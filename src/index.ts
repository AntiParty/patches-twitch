import http from 'http';
import { setupServer } from './server';
import { loadCommands } from './handlers/commands';
import { Channel } from './db';
import { validateToken, loadTokensOnStartup } from './server'; // Import from server.ts now
import { startChatBot } from './util/bot';

const commandHandler = loadCommands();
const app = setupServer(commandHandler);

const loadChannels = async () => {
    const channels = await Channel.findAll();
    for (const channel of channels) {
        const { username, access_token } = channel;
        console.log(`Loading channel: ${username}`);
        await validateToken(username, access_token);
        startChatBot(username, commandHandler);
    }
};

http.createServer(app).listen(3000, async () => {
    console.log('Server is running at http://localhost:3000');
    await loadChannels();
    loadTokensOnStartup();
});