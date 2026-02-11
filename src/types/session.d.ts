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
        channelId?: number;
        hasSubscription?: boolean;
        subscriptionTier?: string | null;
        hasSubscriptionScope?: boolean; // Whether user has user:read:subscriptions scope

        // Admin session properties
        isAdmin?: boolean;
        username?: string;
        role?: string;
        banned?: boolean;
        banReason?: string | null;
    }
}

export { };
