/**
 * Twitch Subscription Service
 * Checks if users are subscribed to antiparty on Twitch for premium access
 */
import axios from 'axios';
import logger from '@/util/logger';
import { Channel } from '@/db';
import { TWITCH_HTTP_TIMEOUT_MS } from '@/util/httpTimeouts';
import { resolvePremiumStatus, loadActiveGrant, PremiumGrant } from '@/services/premiumStatus.service';

// Your Twitch channel ID (antiparty)
const ANTIPARTY_BROADCASTER_ID = process.env.ANTIPARTY_TWITCH_ID || '123456789';

const clientId = process.env.TWITCH_CLIENT_ID!;

export interface SubscriptionStatus {
    isPremium: boolean;
    tier: string | null;      // "1000" = Tier 1, "2000" = Tier 2, "3000" = Tier 3
    giftedBy: string | null;  // If subscription was gifted
    checkedAt: Date;
    /** True when Twitch gave no verdict (401/403/429/5xx/timeout/network). Callers must not persist isPremium=false. */
    unknown?: boolean;
    /** HTTP status behind an unknown result, when Twitch responded at all. */
    httpStatus?: number;
}

type HttpGet = (url: string, config?: any) => Promise<{ data: any }>;

function unknownStatus(httpStatus?: number): SubscriptionStatus {
    return {
        isPremium: false,
        tier: null,
        giftedBy: null,
        checkedAt: new Date(),
        unknown: true,
        ...(httpStatus !== undefined ? { httpStatus } : {})
    };
}

/**
 * Check if a user is subscribed to antiparty on Twitch
 * Uses the user's OAuth token to check their subscription status.
 * Only a 2xx response and a 404 are verdicts; everything else is `unknown`.
 */
export async function checkTwitchSubscription(
    userAccessToken: string,
    userId: string,
    deps: { get?: HttpGet } = {}
): Promise<SubscriptionStatus> {
    const get: HttpGet = deps.get ?? ((url, config) => axios.get(url, config));
    try {
        const response = await get(
            `https://api.twitch.tv/helix/subscriptions/user`,
            {
                params: {
                    broadcaster_id: ANTIPARTY_BROADCASTER_ID,
                    user_id: userId
                },
                headers: {
                    'Authorization': `Bearer ${userAccessToken}`,
                    'Client-Id': clientId
                },
                timeout: TWITCH_HTTP_TIMEOUT_MS
            }
        );

        const data = response.data;

        if (data?.data && data.data.length > 0) {
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
        const status: number | undefined = error?.response?.status;

        // 404 means no subscription found (this is expected for non-subscribers)
        if (status === 404) {
            logger.info(`[TwitchSub] User ${userId} is NOT subscribed to antiparty (404)`);
            return {
                isPremium: false,
                tier: null,
                giftedBy: null,
                checkedAt: new Date()
            };
        }

        logger.error(`[TwitchSub] Error checking subscription for user ${userId}:`, error?.message);
        if (status === 401) {
            logger.warn(`[TwitchSub] Token may be expired for user ${userId}`);
        }

        // Anything else (401/403/429/5xx/timeout/network) is no verdict from Twitch.
        // Flag it so callers keep the stored subscription instead of downgrading it.
        return unknownStatus(status);
    }
}

export interface PremiumStatusDeps {
    findChannel?: (channelId: number) => Promise<any | null>;
    decrypt?: (channel: any) => string | null;
    refresh?: (channel: any) => Promise<string | null | undefined>;
    check?: (token: string, userId: string) => Promise<SubscriptionStatus>;
    loadGrant?: (channelId: number) => Promise<PremiumGrant | null>;
    updateChannel?: (channelId: number, values: { has_subscription: boolean; subscription_tier: string | null }) => Promise<void>;
}

/**
 * Check and update premium status for a user in the database.
 * Twitch sub OR an active manual grant gives premium. Returns the resolved status;
 * `unknown: true` means nothing was written.
 */
export async function checkAndUpdatePremiumStatus(
    channelId: number,
    deps: PremiumStatusDeps = {}
): Promise<SubscriptionStatus> {
    try {
        const findChannel = deps.findChannel ?? ((id: number) => Channel.findByPk(id));
        const check = deps.check ?? ((token: string, userId: string) => checkTwitchSubscription(token, userId));
        const loadGrant = deps.loadGrant ?? loadActiveGrant;
        const updateChannel = deps.updateChannel ?? (async (id: number, values: { has_subscription: boolean; subscription_tier: string | null }) => {
            await Channel.update(values, { where: { id } });
        });

        const channel = await findChannel(channelId);

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

        // Lazy require: twitchUtils pulls in many modules; avoid import cycles.
        const decrypt = deps.decrypt ?? ((c: any) => require('@/util/twitchUtils').decryptChannelAccessToken(c) as string | null);
        const refresh = deps.refresh ?? ((c: any) => require('@/util/twitchUtils').refreshAccessToken(c) as Promise<string | null>);

        const accessToken = decrypt(channel);
        if (!accessToken) {
            logger.warn(`[TwitchSub] Could not decrypt access token for ${channel.username}; keeping stored status.`);
            return unknownStatus();
        }

        let status = await check(accessToken, channel.twitch_user_id);

        if (status.unknown && status.httpStatus === 401) {
            logger.info(`[TwitchSub] Token rejected for ${channel.username}; refreshing once and retrying.`);
            const freshToken = await refresh(channel);
            if (!freshToken) {
                logger.warn(`[TwitchSub] Token refresh failed for ${channel.username}; keeping stored status.`);
                return unknownStatus(401);
            }
            status = await check(freshToken, channel.twitch_user_id);
        }

        if (status.unknown) {
            logger.warn(`[TwitchSub] Could not verify subscription for ${channel.username} (no verdict from Twitch); keeping stored status.`);
            return status;
        }

        const grant = await loadGrant(channelId);
        const resolved = resolvePremiumStatus(status, grant);

        await updateChannel(channelId, {
            has_subscription: resolved.hasSubscription,
            subscription_tier: resolved.tier
        });

        logger.info(`[TwitchSub] Updated premium status for ${channel.username}: isPremium=${resolved.hasSubscription}, tier=${resolved.tier}`);

        return { ...status, isPremium: resolved.hasSubscription, tier: resolved.tier };

    } catch (error) {
        logger.error(`[TwitchSub] Error updating premium status for channel ${channelId}:`, error);
        // Unexpected failure: no verdict, so callers must not persist or display a downgrade.
        return unknownStatus();
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
