// Session configuration with database-backed store
import session from 'express-session';
import SequelizeStore from 'connect-session-sequelize';
import { sequelizeSessions, dbSessionsReady } from '@/dbSessions';
import logger from '@/util/logger';

// Create Sequelize store
const SessionStore = SequelizeStore(session.Store);

// Configure session store with automatic cleanup
const sessionStore = new SessionStore({
    db: sequelizeSessions,
    tableName: 'Sessions',
    checkExpirationInterval: 15 * 60 * 1000, // Cleanup expired sessions every 15 minutes
    expiration: 24 * 60 * 60 * 1000, // Sessions expire after 24 hours
    disableTouch: false, // Update session expiry on each request
});

// Session configuration
export const sessionConfig: session.SessionOptions = {
    name: 'admin.sid',
    secret: process.env.SESSION_SECRET || 'change_this_secret',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000, // 1 day
    },
};

// Initialize session store - must be called before server starts
export async function initSessionStore(): Promise<void> {
    try {
        // Wait for DB connection first
        await dbSessionsReady;

        // Sync the session store table specifically
        // Note: dbSessionsReady already calls sync(), but this ensures the specific table exists
        await sessionStore.sync();
        logger.info('[SessionConfig] Session store initialized');
    } catch (err: any) {
        logger.error('[SessionConfig] Failed to initialize session store:', err?.message || err);
        throw err;
    }
}

export { sessionStore };