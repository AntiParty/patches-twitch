export interface RestorableGiveaway {
  id: number
  channel: string
  type: string
  status: string
  rewardId: string | null
}

export interface RestorableChannel {
  broadcasterId: string
  accessToken: string
}

export interface GiveawaySubscriptionRestoreDependencies {
  resolveChannel: (channel: string) => Promise<RestorableChannel | null>
  subscribe: (input: {
    giveawayId: number
    channel: string
    broadcasterId: string
    accessToken: string
    rewardId: string
  }) => void | Promise<void>
  onError?: (giveaway: RestorableGiveaway, error: unknown) => void
}

export function isRestorableRedeemGiveaway(
  status: string,
  type: string,
  rewardId: string | null,
): boolean {
  return type === 'redeem' && status !== 'closed' && Boolean(rewardId)
}

export async function restoreGiveawayRedemptionSubscriptions(
  giveaways: RestorableGiveaway[],
  deps: GiveawaySubscriptionRestoreDependencies,
): Promise<{ restored: number; skipped: number; failed: number }> {
  let restored = 0
  let skipped = 0
  let failed = 0

  for (const giveaway of giveaways) {
    if (!isRestorableRedeemGiveaway(giveaway.status, giveaway.type, giveaway.rewardId)) {
      skipped += 1
      continue
    }

    try {
      const channel = await deps.resolveChannel(giveaway.channel)
      if (!channel) {
        failed += 1
        deps.onError?.(giveaway, new Error('channel_or_token_unavailable'))
        continue
      }
      await deps.subscribe({
        giveawayId: giveaway.id,
        channel: giveaway.channel,
        broadcasterId: channel.broadcasterId,
        accessToken: channel.accessToken,
        rewardId: giveaway.rewardId!,
      })
      restored += 1
    } catch (error) {
      failed += 1
      deps.onError?.(giveaway, error)
    }
  }

  return { restored, skipped, failed }
}
