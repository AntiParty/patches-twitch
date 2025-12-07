import { Sequelize } from 'sequelize';
import path from 'path';
import fs from 'fs';
import logger from '@/util/logger';

// Ensure data directory exists
const dataDir = path.resolve(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Create Sequelize instance for sessions database
const sequelizeSessions = new Sequelize({
    dialect: 'sqlite',
    storage: path.resolve(dataDir, 'sessions.sqlite'),
    logging: false, // Set to console.log to see SQL queries
    pool: {
        max: 5,
        min: 0,
        acquire: 30000,
        idle: 10000
    },
    retry: {
        max: 3
    }
});

// Initialize database connection
export const dbSessionsReady = sequelizeSessions.authenticate()
    .then(() => {
        logger.info('[dbSessions] Session database connection established');
        return sequelizeSessions.sync(); // Sync tables
    })
    .then(() => {
        logger.info('[dbSessions] Session tables synced');
    })
    .catch(err => {
        logger.error('[dbSessions] Failed to initialize session database:', err);
        throw err;
    });
export { sequelizeSessions };