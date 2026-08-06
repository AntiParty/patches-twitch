import { strict as assert } from 'assert'
import {
  isRestorableRedeemGiveaway,
  restoreGiveawayRedemptionSubscriptions,
} from '@/services/giveawaySubscriptionRestore.service'

describe('giveaway redemption subscription restoration', () => {
  it('restores every non-closed redeem giveaway that has a reward id', () => {
    for (const status of ['open', 'paused', 'locked', 'drawn']) {
      assert.equal(isRestorableRedeemGiveaway(status, 'redeem', 'reward-1'), true)
    }
    assert.equal(isRestorableRedeemGiveaway('closed', 'redeem', 'reward-1'), false)
    assert.equal(isRestorableRedeemGiveaway('open', 'ticket', 'reward-1'), false)
    assert.equal(isRestorableRedeemGiveaway('open', 'redeem', null), false)
  })

  it('isolates one failed giveaway and continues restoring the others', async () => {
    const subscribed: number[] = []
    const result = await restoreGiveawayRedemptionSubscriptions(
      [
        { id: 1, channel: 'alpha', type: 'redeem', status: 'open', rewardId: 'reward-a' },
        { id: 2, channel: 'missing', type: 'redeem', status: 'paused', rewardId: 'reward-b' },
        { id: 3, channel: 'charlie', type: 'redeem', status: 'drawn', rewardId: 'reward-c' },
        { id: 4, channel: 'closed', type: 'redeem', status: 'closed', rewardId: 'reward-d' },
      ],
      {
        resolveChannel: async (channel) => channel === 'missing'
          ? null
          : { broadcasterId: `id-${channel}`, accessToken: `token-${channel}` },
        subscribe: (giveaway) => {
          subscribed.push(giveaway.giveawayId)
        },
      },
    )

    assert.deepEqual(subscribed, [1, 3])
    assert.deepEqual(result, { restored: 2, skipped: 1, failed: 1 })
  })
})
