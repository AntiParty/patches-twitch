import http from 'http';
import { setupServer } from './server';
import { loadCommands } from './handlers/commands';
import { Channel, dbReady } from './db';
import { validateToken, loadTokensOnStartup } from './server';
import { startChatBot } from './util/bot';
import { startCacheUpdater } from './jobs/cacheUpdater';
import logger from './util/logger';

// Initialize these after database is ready
let commandHandler: any;
let app: any;

const initializeApp = async () => {
    commandHandler = loadCommands();
    app = setupServer();
};

const loadChannels = async () => {
    try {
        const channels = await Channel.findAll();
        logger.info(`Found ${channels.length} channels to load`);
        for (const channel of channels) {
            const { username, access_token } = channel;
            logger.info(`Loading channel: ${username}`);
            await validateToken(username, access_token);
            startChatBot(username, commandHandler);
        }
    } catch (error) {
        logger.error('Error loading channels:', error);
        throw error;
    }
};

// Wait for database first, then initialize everything
dbReady.then(async () => {
    logger.info('Database ready, initializing application...');
    
    try {
        // Initialize app components
        await initializeApp();
        
        // Create server
        const server = http.createServer(app);
        
        // Load data and start services
        await loadChannels();
        await loadTokensOnStartup(); // Make sure this is awaited if it's async
        startCacheUpdater();
        
        // Start server
        server.listen(3000, () => {
            logger.info('Server is running at http://localhost:3000');
        });
        
    } catch (error) {
        logger.error('Failed to initialize application:', error);
        process.exit(1);
    }
}).catch(error => {
    logger.error('Database initialization failed:', error);
    process.exit(1);
});