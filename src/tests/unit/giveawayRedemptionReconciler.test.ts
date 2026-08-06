import { strict as assert } from 'assert'
import {
  createGiveawayRedemptionReconciler,
  type GiveawayReconciliationCandidate,
} from '@/jobs/giveawayRedemptionReconciler'

describe('giveaway redemption reconciler', () => {
  const candidate = (giveawayId: number): GiveawayReconciliationCandidate => ({
    giveawayId,
    channelId: giveawayId + 100,
    channel: `channel-${giveawayId}`,
    rewardId: `reward-${giveawayId}`,
  })

  it('prevents overlapping reconciliation for the same giveaway', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    let calls = 0
    const reconciler = createGiveawayRedemptionReconciler({
      listCandidates: async () => [candidate(1)],
      reconcile: async () => {
        calls += 1
        await blocked
        return { inserted: 0 }
      },
    })

    const first = reconciler.runOnce()
    await new Promise((resolve) => setImmediate(resolve))
    const second = await reconciler.runOnce()
    release()
    await first

    assert.equal(calls, 1)
    assert.deepEqual(second, { processed: 0, skipped: 1, failed: 0, inserted: 0 })
  })

  it('isolates one failed giveaway and continues reconciling the others', async () => {
    const errors: number[] = []
    const reconciler = createGiveawayRedemptionReconciler({
      listCandidates: async () => [candidate(1), candidate(2)],
      reconcile: async (entry) => {
        if (entry.giveawayId === 1) throw new Error('Twitch unavailable')
        return { inserted: 3 }
      },
      onError: (entry) => errors.push(entry.giveawayId),
    })

    const result = await reconciler.runOnce()

    assert.deepEqual(result, { processed: 2, skipped: 0, failed: 1, inserted: 3 })
    assert.deepEqual(errors, [1])
  })

  it('clears its interval during shutdown', () => {
    const scheduled: unknown[] = []
    const cleared: unknown[] = []
    const reconciler = createGiveawayRedemptionReconciler(
      {
        listCandidates: async () => [],
        reconcile: async () => ({ inserted: 0 }),
      },
      60_000,
      {
        setInterval: (_callback, intervalMs) => {
          const handle = { intervalMs }
          scheduled.push(handle)
          return handle
        },
        clearInterval: (handle) => cleared.push(handle),
      },
    )

    reconciler.start()
    reconciler.stop()

    assert.equal(scheduled.length, 1)
    assert.deepEqual(cleared, scheduled)
  })
})
