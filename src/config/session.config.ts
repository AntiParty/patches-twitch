// Session configuration with database-backed store
import session from 'express-session';
import SequelizeStore from 'connect-session-sequelize';
import { sequelizeSessions, dbSessionsReady } from '@/dbSessions';
import logger from '@/util/logger';

// Validate required secrets at startup
const SESSION_SECRET = process.env.SESSION_SECRET;
const WEAK_SECRETS = ['change_this_secret', 'supersecret', 'secret', 'password', ''];

if (!SESSION_SECRET) {
    throw new Error('CRITICAL: SESSION_SECRET environment variable is required. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
}

if (WEAK_SECRETS.includes(SESSION_SECRET) || SESSION_SECRET.length < 32) {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('CRITICAL: SESSION_SECRET is too weak for production. Use a 64+ character random string.');
    } else {
        logger.warn('[SessionConfig] WARNING: SESSION_SECRET is weak. Use a 64+ character random string in production.');
    }
}

// Create Sequelize store
const SessionStore = SequelizeStore(session.Store);

// Configure session store with automatic cleanup
const sessionStore = new SessionStore({
    db: sequelizeSessions,
    tableName: 'Sessions',
    checkExpirationInterval: 15 * 60 * 1000, // Cleanup expired sessions every 15 minutes
    expiration: 7 * 24 * 60 * 60 * 1000, // Sessions expire after 7 days
    disableTouch: false, // Update session expiry on each request
});

// Session configuration
export const sessionConfig: session.SessionOptions = {
    // Use configurable cookie name; avoid indicating admin in cookie name
    name: process.env.SESSION_NAME || 'fsr.sid',
    secret: SESSION_SECRET, // Validated above - no fallback
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    // Refresh expiry on activity; reduces fixation window
    rolling: true,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        // 7 days by default
        maxAge: Number(process.env.SESSION_MAX_AGE_MS) || 7 * 24 * 60 * 60 * 1000,
        path: '/',
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