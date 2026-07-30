import { describe, expect, test } from 'bun:test'
import {
  buildWheelSegments,
  filterGiveawayEntrants,
  randomSpinTurns,
  wheelLandingRotation,
} from '../src/features/dashboard/giveawayDisplay'

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
