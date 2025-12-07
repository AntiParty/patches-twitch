/**
 * Express Session Type Extensions
 * Adds custom properties to express-session
 */

declare module 'express-session' {
    interface SessionData {
        // User session properties
        isUser?: boolean;
        twitchUserId?: string;
        twitchUsername?: string;

        // Admin session properties
        isAdmin?: boolean;
        username?: string;
    }
}

export { };
