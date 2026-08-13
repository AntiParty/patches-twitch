import type { GiveawayEntrant } from '@/types/giveaway'

export interface WheelSegment {
  username: string
  entryNumber: number
  isWinner?: boolean
}

export function twitchAvatarUrl(username: string): string {
  return `https://unavatar.io/twitch/${encodeURIComponent(username.replace(/^@/, ''))}`
}

export function avatarInitial(username: string): string {
  return username.replace(/^@/, '').trim().charAt(0).toLocaleUpperCase() || '?'
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

export function giveawayWinChance(entrants: GiveawayEntrant[], winner: string): number {
  const normalizedWinner = winner.replace(/^@/, '').trim().toLocaleLowerCase()
  const totalEntries = entrants.reduce(
    (total, entrant) => total + Math.max(0, Math.floor(entrant.count)),
    0,
  )
  if (totalEntries === 0) return 0

  const winnerEntries = entrants
    .filter((entrant) => entrant.username.replace(/^@/, '').trim().toLocaleLowerCase() === normalizedWinner)
    .reduce((total, entrant) => total + Math.max(0, Math.floor(entrant.count)), 0)

  return Math.round((winnerEntries / totalEntries) * 1000) / 10
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

export function buildReelCards(
  entrants: GiveawayEntrant[],
  winner: string,
  leadInCards = 8,
  trailingCards = 10,
  random: () => number = secureRandomUnit,
): WheelSegment[] {
  const leadIn = Math.max(0, Math.floor(leadInCards))
  const trailing = Math.max(0, Math.floor(trailingCards))
  const segments = buildWheelSegments(entrants, winner, leadIn + trailing + 1, random)
  const winnerCard = segments.find((segment) => segment.isWinner) ?? {
    username: winner,
    entryNumber: 1,
    isWinner: true,
  }
  const candidates = segments.filter((segment) => !segment.isWinner)
  const fallback = { username: winner, entryNumber: winnerCard.entryNumber }
  const cards: WheelSegment[] = Array.from(
    { length: leadIn + trailing },
    (_, index) => candidates[index % Math.max(1, candidates.length)] ?? fallback,
  ).map((segment) => ({ ...segment, isWinner: undefined }))

  cards.splice(leadIn, 0, { ...winnerCard, isWinner: true })
  return cards
}

export function reelLandingOffset(
  winnerIndex: number,
  cardWidth: number,
  cardGap: number,
  viewportWidth: number,
): number {
  return winnerIndex * (cardWidth + cardGap) - (viewportWidth - cardWidth) / 2
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
