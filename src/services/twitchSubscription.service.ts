/**
 * Twitch Subscription Service
 * Checks if users are subscribed to antiparty on Twitch for premium access
 */
import axios from 'axios';
import logger from '@/util/logger';
import { Channel } from '@/db';

// Your Twitch channel ID (antiparty)
const ANTIPARTY_BROADCASTER_ID = process.env.ANTIPARTY_TWITCH_ID || '123456789';

const clientId = process.env.TWITCH_CLIENT_ID!;

interface SubscriptionStatus {
    isPremium: boolean;
    tier: string | null;      // "1000" = Tier 1, "2000" = Tier 2, "3000" = Tier 3
    giftedBy: string | null;  // If subscription was gifted
    checkedAt: Date;
}

/**
 * Check if a user is subscribed to antiparty on Twitch
 * Uses the user's OAuth token to check their subscription status
 */
export async function checkTwitchSubscription(
    userAccessToken: string,
    userId: string
): Promise<SubscriptionStatus> {
    try {
        // Check if user is subscribed to antiparty
        const response = await axios.get(
            `https://api.twitch.tv/helix/subscriptions/user`,
            {
                params: {
                    broadcaster_id: ANTIPARTY_BROADCASTER_ID,
                    user_id: userId
                },
                headers: {
                    'Authorization': `Bearer ${userAccessToken}`,
                    'Client-Id': clientId
                }
            }
        );

        const data = response.data;

        if (data.data && data.data.length > 0) {
            const sub = data.data[0];
            logger.info(`[TwitchSub] User ${userId} is subscribed to antiparty (Tier ${sub.tier})`);
            return {
                isPremium: true,
                tier: sub.tier,         // "1000", "2000", or "3000"
                giftedBy: sub.gifter_login || null,
                checkedAt: new Date()
            };
        }

        logger.info(`[TwitchSub] User ${userId} is NOT subscribed to antiparty`);
        return {
            isPremium: false,
            tier: null,
            giftedBy: null,
            checkedAt: new Date()
        };

    } catch (error: any) {
        // 404 means no subscription found (this is expected for non-subscribers)
        if (axios.isAxiosError(error) && error.response?.status === 404) {
            logger.info(`[TwitchSub] User ${userId} is NOT subscribed to antiparty (404)`);
            return {
                isPremium: false,
                tier: null,
                giftedBy: null,
                checkedAt: new Date()
            };
        }

        // For other errors, log and return false
        logger.error(`[TwitchSub] Error checking subscription for user ${userId}:`, error.message);

        // If token is invalid/expired, we might need to refresh
        if (axios.isAxiosError(error) && error.response?.status === 401) {
            logger.warn(`[TwitchSub] Token may be expired for user ${userId}`);
        }

        return {
            isPremium: false,
            tier: null,
            giftedBy: null,
            checkedAt: new Date()
        };
    }
}

/**
 * Check and update premium status for a user in the database
 * Returns the updated status
 */
export async function checkAndUpdatePremiumStatus(channelId: number): Promise<SubscriptionStatus> {
    try {
        const channel = await Channel.findByPk(channelId);

        if (!channel) {
            logger.error(`[TwitchSub] Channel ${channelId} not found`);
            return {
                isPremium: false,
                tier: null,
                giftedBy: null,
                checkedAt: new Date()
            }; 
        }

        if (!channel.access_token || !channel.twitch_user_id) {
            logger.warn(`[TwitchSub] Channel ${channelId} missing token or user ID`);
            return {
                isPremium: false,
                tier: null,
                giftedBy: null,
                checkedAt: new Date()
            };
        }

        // Use the access token directly (no encryption)
        const accessToken = channel.access_token;

        // Check subscription status
        const status = await checkTwitchSubscription(accessToken, channel.twitch_user_id);

        // Update the database
        await Channel.update(
            {
                has_subscription: status.isPremium,
                subscription_tier: status.tier
            },
            { where: { id: channelId } }
        );

        logger.info(`[TwitchSub] Updated premium status for ${channel.username}: isPremium=${status.isPremium}, tier=${status.tier}`);

        return status;

    } catch (error) {
        logger.error(`[TwitchSub] Error updating premium status for channel ${channelId}:`, error);
        return {
            isPremium: false,
            tier: null,
            giftedBy: null,
            checkedAt: new Date()
        };
    }
}

/**
 * Get tier display name
 */
export function getTierName(tier: string | null): string {
    switch (tier) {
        case '1000': return 'Tier 1';
        case '2000': return 'Tier 2';
        case '3000': return 'Tier 3';
        default: return 'None';
    }
}

/**
 * Check if we should re-verify subscription
 * (e.g., if last check was more than 1 hour ago)
 */
export function shouldRecheckSubscription(lastChecked: Date | null, maxAgeMs: number = 60 * 60 * 1000): boolean {
    if (!lastChecked) return true;
    return Date.now() - lastChecked.getTime() > maxAgeMs;
}

export default {
    checkTwitchSubscription,
    checkAndUpdatePremiumStatus,
    getTierName,
    shouldRecheckSubscription,
    ANTIPARTY_BROADCASTER_ID
};
