import type { GiveawayEntrant } from '@/types/giveaway'

export interface WheelSegment {
  username: string
  entryNumber: number
  isWinner?: boolean
}

const UINT32_RANGE = 0x1_0000_0000

export function secureRandomUnit(): number {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const value = new Uint32Array(1)
    globalThis.crypto.getRandomValues(value)
    return value[0] / UINT32_RANGE
  }
  return Math.random()
}

function normalizedRandom(random: () => number): number {
  return Math.min(1 - Number.EPSILON, Math.max(0, random()))
}

export function randomSpinTurns(
  random: () => number = secureRandomUnit,
  minimum = 6,
  maximum = 9,
): number {
  const low = Math.max(1, Math.floor(minimum))
  const high = Math.max(low, Math.floor(maximum))
  return low + Math.floor(normalizedRandom(random) * (high - low + 1))
}

export function filterGiveawayEntrants(
  entrants: GiveawayEntrant[],
  query: string,
): GiveawayEntrant[] {
  const normalized = query.trim().replace(/^@/, '').toLocaleLowerCase()
  if (!normalized) return entrants
  return entrants.filter((entrant) =>
    entrant.username.toLocaleLowerCase().includes(normalized),
  )
}

export function buildWheelSegments(
  entrants: GiveawayEntrant[],
  winner: string,
  maximumSegments = 24,
  random: () => number = secureRandomUnit,
): WheelSegment[] {
  const weighted = entrants
    .map((entrant) => ({ ...entrant, count: Math.max(0, Math.floor(entrant.count)) }))
    .filter((entrant) => entrant.count > 0)
  const total = weighted.reduce((sum, entrant) => sum + entrant.count, 0)
  const limit = Math.max(1, Math.floor(maximumSegments))

  if (total === 0) return [{ username: winner, entryNumber: 1, isWinner: true }]

  const ticketAt = (entryNumber: number): WheelSegment => {
    let remaining = entryNumber
    for (const entrant of weighted) {
      if (remaining <= entrant.count) {
        return { username: entrant.username, entryNumber }
      }
      remaining -= entrant.count
    }
    return { username: weighted[weighted.length - 1].username, entryNumber: total }
  }

  const segments =
    total <= limit
      ? Array.from({ length: total }, (_, index) => ticketAt(index + 1))
      : Array.from({ length: limit - 1 }, () => {
          const entryNumber = Math.min(
            total,
            Math.floor(normalizedRandom(random) * total) + 1,
          )
          return ticketAt(entryNumber)
        })

  const winnerSegment =
    weighted.reduce(
      (found, entrant, index) =>
        found ??
        (entrant.username === winner
          ? {
              username: winner,
              entryNumber:
                weighted.slice(0, index).reduce((sum, item) => sum + item.count, 0) + 1,
            }
          : null),
      null as WheelSegment | null,
    ) ??
    { username: winner, entryNumber: total }

  const duplicateWinnerTicket = segments.findIndex(
    (segment) => segment.entryNumber === winnerSegment.entryNumber,
  )
  if (duplicateWinnerTicket >= 0) segments.splice(duplicateWinnerTicket, 1)
  if (segments.length >= limit) segments.pop()
  const winnerIndex = Math.floor(normalizedRandom(random) * (segments.length + 1))
  segments.splice(winnerIndex, 0, { ...winnerSegment, isWinner: true })
  return segments
}

export function wheelLandingRotation(
  winnerIndex: number,
  segmentCount: number,
  turns = 6,
): number {
  const safeCount = Math.max(1, Math.floor(segmentCount))
  const slice = 360 / safeCount
  return Math.max(1, Math.floor(turns)) * 360 - (winnerIndex + 0.5) * slice
}
