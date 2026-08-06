import { strict as assert } from 'assert'
import {
  recoverGiveawayRedemptions,
  type GiveawayRecoveryDependencies,
  type TwitchRewardRedemption,
} from '@/services/giveawayRedemptionRecovery.service'
import { parseRewardRedemptionsPage } from '@/services/twitchChannelPoints.service'

describe('giveaway redemption recovery', () => {
  const redemption = (
    id: string,
    userId: string,
    username: string,
    status: 'FULFILLED' | 'UNFULFILLED' = 'FULFILLED',
  ): TwitchRewardRedemption => ({
    id,
    userId,
    username,
    status,
    redeemedAt: '2026-08-06T10:00:00Z',
  })

  it('paginates fulfilled and unfulfilled redemptions, validates them, and deduplicates by id', async () => {
    const calls: Array<{ status: string; after?: string }> = []
    let insertCalled = false
    const deps: GiveawayRecoveryDependencies = {
      fetchPage: async (status, after) => {
        calls.push({ status, after })
        if (status === 'FULFILLED' && after === undefined) {
          return {
            redemptions: [
              redemption('r-1', 'u-1', 'Alpha'),
              redemption('', 'u-bad', 'Invalid'),
              { ...redemption('r-bad-date', 'u-date', 'Bad Date'), redeemedAt: 'not-a-date' },
            ],
            cursor: 'fulfilled-page-2',
          }
        }
        if (status === 'FULFILLED' && after === 'fulfilled-page-2') {
          return { redemptions: [redemption('r-2', 'u-2', 'Bravo')], cursor: null }
        }
        return {
          redemptions: [
            redemption('r-2', 'u-2', 'Bravo', 'UNFULFILLED'),
            redemption('r-3', 'u-3', 'Charlie', 'UNFULFILLED'),
          ],
          cursor: null,
        }
      },
      listExistingRedemptionIds: async () => ['r-2'],
      insertMissing: async () => {
        insertCalled = true
        return 0
      },
    }

    const result = await recoverGiveawayRedemptions({ apply: false }, deps)

    assert.deepEqual(calls, [
      { status: 'FULFILLED', after: undefined },
      { status: 'FULFILLED', after: 'fulfilled-page-2' },
      { status: 'UNFULFILLED', after: undefined },
    ])
    assert.equal(insertCalled, false)
    assert.deepEqual(result, {
      fetched: 3,
      invalid: 2,
      alreadyStored: 1,
      missing: 2,
      inserted: 0,
      projectedTotal: 3,
      applied: false,
    })
  })

  it('inserts only missing redemptions when apply is enabled', async () => {
    const inserted: TwitchRewardRedemption[] = []
    const deps: GiveawayRecoveryDependencies = {
      fetchPage: async (status) => ({
        redemptions:
          status === 'FULFILLED'
            ? [redemption('r-1', 'u-1', 'Alpha'), redemption('r-2', 'u-2', 'Bravo')]
            : [],
        cursor: null,
      }),
      listExistingRedemptionIds: async () => ['r-1'],
      insertMissing: async (redemptions) => {
        inserted.push(...redemptions)
        return redemptions.length
      },
    }

    const result = await recoverGiveawayRedemptions({ apply: true }, deps)

    assert.deepEqual(inserted.map((entry) => entry.id), ['r-2'])
    assert.equal(result.missing, 1)
    assert.equal(result.inserted, 1)
    assert.equal(result.projectedTotal, 2)
    assert.equal(result.applied, true)
  })

  it('fails safely when Twitch repeats a pagination cursor', async () => {
    const deps: GiveawayRecoveryDependencies = {
      fetchPage: async () => ({ redemptions: [], cursor: 'same-cursor' }),
      listExistingRedemptionIds: async () => [],
      insertMissing: async () => 0,
    }

    await assert.rejects(
      recoverGiveawayRedemptions({ apply: false }, deps),
      /repeated pagination cursor/i,
    )
  })

  it('normalizes a Twitch redemption page without hiding malformed records', () => {
    const page = parseRewardRedemptionsPage({
      data: [
        {
          broadcaster_id: 'broadcaster-1',
          broadcaster_login: 'ekazoko',
          broadcaster_name: 'EkaZoko',
          id: 'redemption-1',
          user_id: 'viewer-1',
          user_login: 'viewer_login',
          user_name: 'Viewer Name',
          user_input: '',
          status: 'FULFILLED',
          redeemed_at: '2026-08-06T10:00:00Z',
          reward: {
            id: 'reward-1',
            title: 'Giveaway',
            prompt: '',
            cost: 500,
          },
        },
        {
          broadcaster_id: 'broadcaster-1',
          broadcaster_login: 'ekazoko',
          broadcaster_name: 'EkaZoko',
          id: 'redemption-invalid',
          user_name: 'Missing ID',
          user_login: 'missing_id',
          user_input: '',
          status: 'UNFULFILLED',
          redeemed_at: '2026-08-06T10:01:00Z',
          reward: {
            id: 'reward-1',
            title: 'Giveaway',
            prompt: '',
            cost: 500,
          },
        },
      ],
      pagination: { cursor: 'next-page' },
    })

    assert.deepEqual(page, {
      redemptions: [
        {
          id: 'redemption-1',
          userId: 'viewer-1',
          username: 'Viewer Name',
          status: 'FULFILLED',
          redeemedAt: '2026-08-06T10:00:00Z',
        },
        {
          id: 'redemption-invalid',
          userId: '',
          username: 'Missing ID',
          status: 'UNFULFILLED',
          redeemedAt: '2026-08-06T10:01:00Z',
        },
      ],
      cursor: 'next-page',
    })
  })
})
