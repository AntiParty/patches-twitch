/**
 * Premium status resolution.
 * Combines the Twitch subscription verdict with admin/manual grants so a login or
 * refresh never wipes a still-valid grant.
 */

export interface TwitchPremiumInput {
    isPremium: boolean;
    tier: string | null;
}

export interface PremiumGrant {
    status?: string | null;
    plan_type?: string | null;
    current_period_end?: Date | string | null;
}

export interface ResolvedPremium {
    hasSubscription: boolean;
    tier: string | null;
}

export function resolvePremiumStatus(
    twitch: TwitchPremiumInput,
    grant: PremiumGrant | null | undefined,
    now: Date = new Date()
): ResolvedPremium {
    if (twitch.isPremium) {
        return { hasSubscription: true, tier: twitch.tier };
    }

    if (grant && grant.status === 'active') {
        const end = grant.current_period_end ? new Date(grant.current_period_end) : null;
        if (!end || end.getTime() > now.getTime()) {
            return { hasSubscription: true, tier: grant.plan_type ?? null };
        }
    }

    return { hasSubscription: false, tier: null };
}

/** Find the channel's active grant with the latest expiry (null expiry = never expires). */
export async function loadActiveGrant(channelId: number): Promise<PremiumGrant | null> {
    const { Subscription } = await import('@/db');
    const grants: any[] = await Subscription.findAll({
        where: { channel_id: channelId, status: 'active' },
    });
    const now = Date.now();
    let best: any = null;
    for (const g of grants) {
        const end = g.current_period_end ? new Date(g.current_period_end).getTime() : null;
        if (end !== null && end <= now) continue;
        if (!best) { best = g; continue; }
        const bestEnd = best.current_period_end ? new Date(best.current_period_end).getTime() : null;
        if (bestEnd === null) continue;
        if (end === null || end > bestEnd) best = g;
    }
    return best;
}
