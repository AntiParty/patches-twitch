import { strict as assert } from 'assert'
import {
  replaceRewardForNextRound,
  type GiveawayRoundRewardDependencies,
} from '@/services/giveawayRoundReward.service'

describe('replaceRewardForNextRound', () => {
  it('replaces the Twitch reward, stores its new id, and rebinds EventSub in order', async () => {
    const calls: string[] = []
    const deps: GiveawayRoundRewardDependencies = {
      snapshotReward: async () => {
        calls.push('snapshot')
        return { title: 'Giveaway', cost: 500, maxPerUserPerStream: 1 }
      },
      removeSubscription: async () => {
        calls.push('unsubscribe')
      },
      deleteReward: async () => {
        calls.push('delete')
        return true
      },
      createReward: async () => {
        calls.push('create')
        return { ok: true, rewardId: 'reward-new' }
      },
      updateReward: async (_channelId, rewardId, update) => {
        calls.push(`rename:${rewardId}:${update.title}`)
        return true
      },
      storeRewardId: async (rewardId) => {
        calls.push(`store:${rewardId}`)
      },
      addSubscription: () => {
        calls.push('subscribe')
      },
      setRewardPaused: async (_channelId, rewardId, paused) => {
        calls.push(`${paused ? 'pause' : 'unpause'}:${rewardId}`)
        return true
      },
      getRewardPausedState: async (_channelId, rewardId) => {
        calls.push(`verify-unpaused:${rewardId}`)
        return false
      },
      resetEntries: async () => {
        calls.push('reset-entries')
        return true
      },
    }

    const rewardId = await replaceRewardForNextRound(
      { channelId: 7, broadcasterId: 'broadcaster', accessToken: 'token', rewardId: 'reward-old' },
      deps,
    )

    assert.equal(rewardId, 'reward-new')
    assert.deepEqual(calls, [
      'snapshot',
      'rename:reward-old:Giveaway · previous',
      'create',
      'pause:reward-new',
      'unsubscribe',
      'delete',
      'store:reward-new',
      'subscribe',
      'reset-entries',
      'unpause:reward-new',
      'verify-unpaused:reward-new',
    ])
  })

  it('retries opening the reward when Twitch still reports it as paused', async () => {
    let unpauseAttempts = 0
    const pausedStates = [true, false]
    const deps: GiveawayRoundRewardDependencies = {
      snapshotReward: async () => ({ title: 'Giveaway', cost: 500 }),
      removeSubscription: async () => undefined,
      deleteReward: async () => true,
      createReward: async () => ({ ok: true, rewardId: 'reward-new' }),
      updateReward: async () => true,
      storeRewardId: async () => undefined,
      addSubscription: () => undefined,
      setRewardPaused: async (_channelId, _rewardId, paused) => {
        if (!paused) unpauseAttempts += 1
        return true
      },
      getRewardPausedState: async () => pausedStates.shift() ?? true,
      resetEntries: async () => true,
    }

    await replaceRewardForNextRound(
      { channelId: 7, broadcasterId: 'broadcaster', accessToken: 'token', rewardId: 'reward-old' },
      deps,
    )

    assert.equal(unpauseAttempts, 2)
  })

  it('does not delete the current reward when its settings cannot be read', async () => {
    let deleted = false
    const deps: GiveawayRoundRewardDependencies = {
      snapshotReward: async () => null,
      removeSubscription: async () => undefined,
      deleteReward: async () => {
        deleted = true
        return true
      },
      createReward: async () => ({ ok: false, reason: 'error' }),
      updateReward: async () => true,
      storeRewardId: async () => undefined,
      addSubscription: () => undefined,
      setRewardPaused: async () => true,
      getRewardPausedState: async () => false,
      resetEntries: async () => true,
    }

    await assert.rejects(
      replaceRewardForNextRound(
        { channelId: 7, broadcasterId: 'broadcaster', accessToken: 'token', rewardId: 'reward-old' },
        deps,
      ),
      /read the current Twitch reward/,
    )
    assert.equal(deleted, false)
  })
})
