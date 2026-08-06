export type RecoverableRedemptionStatus = 'FULFILLED' | 'UNFULFILLED'

export interface TwitchRewardRedemption {
  id: string
  userId: string
  username: string
  status: string
  redeemedAt: string
}

export interface TwitchRewardRedemptionPage {
  redemptions: TwitchRewardRedemption[]
  cursor: string | null
}

export interface GiveawayRecoveryDependencies {
  fetchPage: (
    status: RecoverableRedemptionStatus,
    after?: string,
  ) => Promise<TwitchRewardRedemptionPage>
  listExistingRedemptionIds: () => Promise<string[]>
  insertMissing: (redemptions: TwitchRewardRedemption[]) => Promise<number>
}

export interface GiveawayRedemptionRecoveryResult {
  fetched: number
  invalid: number
  alreadyStored: number
  missing: number
  inserted: number
  projectedTotal: number
  applied: boolean
}

const RECOVERABLE_STATUSES: RecoverableRedemptionStatus[] = ['FULFILLED', 'UNFULFILLED']
const MAX_PAGES_PER_STATUS = 1_000

function isValidRedemption(redemption: TwitchRewardRedemption): boolean {
  return Boolean(
    redemption.id.trim()
      && redemption.userId.trim()
      && redemption.username.trim()
      && RECOVERABLE_STATUSES.includes(redemption.status as RecoverableRedemptionStatus)
      && Number.isFinite(Date.parse(redemption.redeemedAt)),
  )
}

export async function recoverGiveawayRedemptions(
  input: { apply: boolean },
  deps: GiveawayRecoveryDependencies,
): Promise<GiveawayRedemptionRecoveryResult> {
  const byId = new Map<string, TwitchRewardRedemption>()
  let invalid = 0

  for (const status of RECOVERABLE_STATUSES) {
    let after: string | undefined
    const seenCursors = new Set<string>()

    for (let pageNumber = 0; pageNumber < MAX_PAGES_PER_STATUS; pageNumber += 1) {
      const page = await deps.fetchPage(status, after)
      for (const redemption of page.redemptions) {
        if (!isValidRedemption(redemption)) {
          invalid += 1
          continue
        }
        if (!byId.has(redemption.id)) {
          byId.set(redemption.id, redemption)
        }
      }

      if (!page.cursor) break
      if (seenCursors.has(page.cursor)) {
        throw new Error(`Twitch returned a repeated pagination cursor for ${status}.`)
      }
      seenCursors.add(page.cursor)
      after = page.cursor

      if (pageNumber === MAX_PAGES_PER_STATUS - 1) {
        throw new Error(`Twitch redemption pagination exceeded ${MAX_PAGES_PER_STATUS} pages for ${status}.`)
      }
    }
  }

  const existingIds = new Set(
    (await deps.listExistingRedemptionIds()).filter((id) => typeof id === 'string' && id.length > 0),
  )
  const missing = [...byId.values()].filter((redemption) => !existingIds.has(redemption.id))
  const alreadyStored = byId.size - missing.length
  const inserted = input.apply && missing.length > 0 ? await deps.insertMissing(missing) : 0

  return {
    fetched: byId.size,
    invalid,
    alreadyStored,
    missing: missing.length,
    inserted,
    projectedTotal: existingIds.size + (input.apply ? inserted : missing.length),
    applied: input.apply,
  }
}
