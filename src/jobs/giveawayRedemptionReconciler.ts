import { Op } from 'sequelize'
import { Channel, Giveaway, GiveawayEntry, sequelize } from '@/db'
import {
  recoverGiveawayRedemptions,
  type TwitchRewardRedemption,
} from '@/services/giveawayRedemptionRecovery.service'
import { getRewardRedemptionsPage } from '@/services/twitchChannelPoints.service'
import logger from '@/util/logger'

export interface GiveawayReconciliationCandidate {
  giveawayId: number
  channelId: number
  channel: string
  rewardId: string
}

export interface GiveawayReconcilerDependencies {
  listCandidates: () => Promise<GiveawayReconciliationCandidate[]>
  reconcile: (candidate: GiveawayReconciliationCandidate) => Promise<{ inserted: number }>
  onResult?: (candidate: GiveawayReconciliationCandidate, result: { inserted: number }) => void
  onError?: (candidate: GiveawayReconciliationCandidate, error: unknown) => void
  onBatchError?: (error: unknown) => void
}

export interface GiveawayReconcilerScheduler {
  setInterval: (callback: () => void, intervalMs: number) => unknown
  clearInterval: (handle: unknown) => void
}

export function createGiveawayRedemptionReconciler(
  deps: GiveawayReconcilerDependencies,
  intervalMs = 60_000,
  scheduler: GiveawayReconcilerScheduler = {
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
  },
) {
  const inFlight = new Set<number>()
  let intervalHandle: unknown | null = null

  const runOnce = async (): Promise<{
    processed: number
    skipped: number
    failed: number
    inserted: number
  }> => {
    const candidates = await deps.listCandidates()
    let processed = 0
    let skipped = 0
    let failed = 0
    let inserted = 0

    await Promise.all(candidates.map(async (candidate) => {
      if (inFlight.has(candidate.giveawayId)) {
        skipped += 1
        return
      }

      inFlight.add(candidate.giveawayId)
      processed += 1
      try {
        const result = await deps.reconcile(candidate)
        inserted += result.inserted
        deps.onResult?.(candidate, result)
      } catch (error) {
        failed += 1
        deps.onError?.(candidate, error)
      } finally {
        inFlight.delete(candidate.giveawayId)
      }
    }))

    return { processed, skipped, failed, inserted }
  }

  const invokeSafely = () => {
    void runOnce().catch((error) => deps.onBatchError?.(error))
  }

  const start = () => {
    if (intervalHandle !== null) return
    invokeSafely()
    intervalHandle = scheduler.setInterval(invokeSafely, intervalMs)
  }

  const stop = () => {
    if (intervalHandle === null) return
    scheduler.clearInterval(intervalHandle)
    intervalHandle = null
  }

  return { runOnce, start, stop }
}

async function listOpenRedeemGiveaways(): Promise<GiveawayReconciliationCandidate[]> {
  const giveaways = await Giveaway.findAll({
    where: {
      type: 'redeem',
      status: 'open',
      reward_id: { [Op.ne]: null },
    },
  })

  const candidates = await Promise.all(giveaways.map(async (giveaway) => {
    const channel = await Channel.findOne({ where: { username: giveaway.channel } })
    if (!channel || !giveaway.reward_id) {
      logger.warn(
        `[GiveawayReconciler] Skipping giveaway ${giveaway.id} in ${giveaway.channel}: ${!channel ? 'channel not found' : 'reward id missing'}`,
      )
      return null
    }
    return {
      giveawayId: giveaway.id,
      channelId: channel.id,
      channel: giveaway.channel,
      rewardId: giveaway.reward_id,
    }
  }))

  return candidates.filter((candidate): candidate is GiveawayReconciliationCandidate => candidate !== null)
}

async function reconcileGiveaway(
  candidate: GiveawayReconciliationCandidate,
): Promise<{ inserted: number }> {
  const existingRows = await GiveawayEntry.findAll({
    attributes: ['redemption_id'],
    where: {
      giveaway_id: candidate.giveawayId,
      redemption_id: { [Op.ne]: null },
    },
    raw: true,
  }) as unknown as Array<{ redemption_id: string | null }>

  const result = await recoverGiveawayRedemptions(
    { apply: true },
    {
      fetchPage: (status, after) => getRewardRedemptionsPage(
        candidate.channelId,
        candidate.rewardId,
        status,
        after,
      ),
      listExistingRedemptionIds: async () => existingRows
        .map((row) => row.redemption_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
      insertMissing: async (redemptions: TwitchRewardRedemption[]) => sequelize.transaction(
        async (transaction) => {
          const current = await Giveaway.findByPk(candidate.giveawayId, { transaction })
          if (
            !current
            || current.type !== 'redeem'
            || current.status !== 'open'
            || current.reward_id !== candidate.rewardId
          ) {
            throw new Error('giveaway_changed_during_reconciliation')
          }

          let inserted = 0
          for (const redemption of redemptions) {
            const [, created] = await GiveawayEntry.findOrCreate({
              where: {
                giveaway_id: candidate.giveawayId,
                redemption_id: redemption.id,
              },
              defaults: {
                giveaway_id: candidate.giveawayId,
                user_id: redemption.userId,
                username: redemption.username,
                redemption_id: redemption.id,
                created_at: new Date(redemption.redeemedAt),
              },
              transaction,
            })
            if (created) inserted += 1
          }
          return inserted
        },
      ),
    },
  )

  if (result.invalid > 0) {
    logger.warn(
      `[GiveawayReconciler] Skipped ${result.invalid} invalid Twitch redemption record(s) for giveaway ${candidate.giveawayId} in ${candidate.channel}`,
    )
  }
  return { inserted: result.inserted }
}

export function startGiveawayRedemptionReconciler(intervalMs = 60_000): () => void {
  const reconciler = createGiveawayRedemptionReconciler(
    {
      listCandidates: listOpenRedeemGiveaways,
      reconcile: reconcileGiveaway,
      onResult: (candidate, result) => {
        if (result.inserted > 0) {
          logger.info(
            `[GiveawayReconciler] Recovered ${result.inserted} missing redemption(s) for giveaway ${candidate.giveawayId} in ${candidate.channel} (reward ${candidate.rewardId})`,
          )
        }
      },
      onError: (candidate, error) => {
        logger.error(
          `[GiveawayReconciler] Failed giveaway ${candidate.giveawayId} in ${candidate.channel} (reward ${candidate.rewardId}): ${error instanceof Error ? error.message : String(error)}`,
        )
      },
      onBatchError: (error) => {
        logger.error(
          `[GiveawayReconciler] Failed to list reconciliation candidates: ${error instanceof Error ? error.message : String(error)}`,
        )
      },
    },
    intervalMs,
  )
  reconciler.start()
  return reconciler.stop
}
