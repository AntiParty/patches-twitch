import type { GiveawayEntrant } from '@/types/giveaway'

export interface WheelSegment {
  username: string
  entryNumber: number
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
  random: () => number = Math.random,
): WheelSegment[] {
  const weighted = entrants
    .map((entrant) => ({ ...entrant, count: Math.max(0, Math.floor(entrant.count)) }))
    .filter((entrant) => entrant.count > 0)
  const total = weighted.reduce((sum, entrant) => sum + entrant.count, 0)
  const limit = Math.max(1, Math.floor(maximumSegments))

  if (total === 0) return [{ username: winner, entryNumber: 1 }]

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
            Math.floor(Math.max(0, random()) * total) + 1,
          )
          return ticketAt(entryNumber)
        })

  const winnerSegment =
    segments.find((segment) => segment.username === winner) ??
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

  const firstWinner = segments.findIndex((segment) => segment.username === winner)
  if (firstWinner >= 0) segments.splice(firstWinner, 1)
  if (segments.length >= limit) segments.pop()
  segments.push(winnerSegment)
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
