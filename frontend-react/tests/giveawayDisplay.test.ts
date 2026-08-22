import { describe, expect, test } from 'bun:test'
import {
  buildWheelSegments,
  giveawayWinChance,
  filterGiveawayEntrants,
  randomSpinTurns,
  wheelLandingRotation,
} from '../src/features/dashboard/giveawayDisplay'
import * as giveawayDisplay from '../src/features/dashboard/giveawayDisplay'

describe('buildWheelSegments', () => {
  const entrants = [
    { userId: 'alpha', username: 'Alpha', count: 3 },
    { userId: 'bravo', username: 'Bravo', count: 1 },
  ]

  test('uses randomness to vary the saved winner position', () => {
    const segments = buildWheelSegments(entrants, 'Bravo', 24, () => 0)

    expect(segments).toHaveLength(4)
    expect(segments[0]).toMatchObject({ username: 'Bravo', isWinner: true })
    expect(segments.at(-1)?.isWinner).not.toBe(true)
  })

  test('marks exactly one winning slice when the winner has multiple entries', () => {
    const segments = buildWheelSegments(entrants, 'Alpha', 24, () => 0.5)

    expect(segments.filter((segment) => segment.isWinner)).toHaveLength(1)
    expect(segments.find((segment) => segment.isWinner)?.username).toBe('Alpha')
  })

  test('caps a huge weighted pool without losing ticket weighting', () => {
    const largePool = [
      { userId: 'alpha', username: 'Alpha', count: 30 },
      { userId: 'bravo', username: 'Bravo', count: 10 },
    ]
    const alphaSegments = buildWheelSegments(largePool, 'Bravo', 4, () => 0)
    const bravoSegments = buildWheelSegments(largePool, 'Alpha', 4, () => 0.99)

    expect(alphaSegments).toHaveLength(4)
    expect(bravoSegments).toHaveLength(4)
    expect(alphaSegments.filter((segment) => segment.isWinner)).toHaveLength(1)
    expect(bravoSegments.filter((segment) => segment.isWinner)).toHaveLength(1)
    expect(alphaSegments.filter((segment) => !segment.isWinner).every(
      (segment) => segment.username === 'Alpha',
    )).toBe(true)
    expect(bravoSegments.filter((segment) => !segment.isWinner).every(
      (segment) => segment.username === 'Bravo',
    )).toBe(true)
  })

  test('still produces a stable wheel when the entrant snapshot is empty', () => {
    expect(buildWheelSegments([], 'Winner', 24, () => 0.5)).toEqual([
      { username: 'Winner', entryNumber: 1, isWinner: true },
    ])
  })
})

describe('wheelLandingRotation', () => {
  test('lands the center of the selected slice under the top pointer', () => {
    expect(wheelLandingRotation(3, 8, 6)).toBe(2002.5)
  })

  test('varies the number of complete turns within a controlled range', () => {
    expect(randomSpinTurns(() => 0)).toBe(6)
    expect(randomSpinTurns(() => 0.999999)).toBe(9)
  })
})

describe('giveaway reel display', () => {
  const entrants = [
    { userId: 'alpha', username: 'Alpha', count: 3 },
    { userId: 'bravo', username: 'Bravo', count: 1 },
  ]

  test('places the saved winner in the landing card after the lead-in cards', () => {
    const cards = giveawayDisplay.buildReelCards(entrants, 'Bravo', 5, 6, () => 0)

    expect(cards).toHaveLength(12)
    expect(cards[5]).toMatchObject({ username: 'Bravo', isWinner: true })
    expect(cards.filter((card) => card.isWinner)).toHaveLength(1)
  })

  test('centers the winner card below the fixed marker', () => {
    expect(giveawayDisplay.reelLandingOffset(5, 132, 12, 660)).toBe(456)
  })

  test('encodes avatar usernames and derives an initial fallback', () => {
    expect(giveawayDisplay.twitchAvatarUrl('A name')).toBe('https://unavatar.io/twitch/A%20name')
    expect(giveawayDisplay.avatarInitial('@patches')).toBe('P')
  })

  test('defers avatar loading until the saved winner is revealed', () => {
    expect(giveawayDisplay.shouldLoadReelAvatar(false, true)).toBe(false)
    expect(giveawayDisplay.shouldLoadReelAvatar(true, false)).toBe(false)
    expect(giveawayDisplay.shouldLoadReelAvatar(true, true)).toBe(true)
  })

  test('calculates the winner chance from their eligible entries', () => {
    expect(giveawayWinChance(entrants, 'Alpha')).toBe(75)
    expect(giveawayWinChance(entrants, 'Bravo')).toBe(25)
  })

  test('keeps one decimal place when the chance cannot be expressed as a whole percent', () => {
    expect(giveawayWinChance([
      { userId: 'alpha', username: 'Alpha', count: 1 },
      { userId: 'bravo', username: 'Bravo', count: 2 },
    ], 'Alpha')).toBe(33.3)
  })

  test('returns zero chance when the winner is absent from an empty pool', () => {
    expect(giveawayWinChance([], 'Winner')).toBe(0)
  })
})

describe('filterGiveawayEntrants', () => {
  const entrants = [
    { userId: 'alpha', username: 'AlphaPlayer', count: 3 },
    { userId: 'bravo', username: 'Bravo', count: 1 },
  ]

  test('matches usernames case-insensitively and accepts a leading @', () => {
    expect(filterGiveawayEntrants(entrants, '  @ALPHA  ')).toEqual([entrants[0]])
  })

  test('returns every entrant for an empty search', () => {
    expect(filterGiveawayEntrants(entrants, '  ')).toEqual(entrants)
  })
})
