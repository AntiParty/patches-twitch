import { describe, expect, test } from 'bun:test'
import {
  buildWheelSegments,
  filterGiveawayEntrants,
  wheelLandingRotation,
} from '../src/features/dashboard/giveawayDisplay'

describe('buildWheelSegments', () => {
  const entrants = [
    { userId: 'alpha', username: 'Alpha', count: 3 },
    { userId: 'bravo', username: 'Bravo', count: 1 },
  ]

  test('keeps the wheel readable and includes the saved winner', () => {
    const segments = buildWheelSegments(entrants, 'Bravo', 24, () => 0)

    expect(segments).toHaveLength(4)
    expect(segments.at(-1)?.username).toBe('Bravo')
  })

  test('caps a huge weighted pool without losing ticket weighting', () => {
    const largePool = [
      { userId: 'alpha', username: 'Alpha', count: 30 },
      { userId: 'bravo', username: 'Bravo', count: 10 },
    ]
    const alphaSegments = buildWheelSegments(largePool, 'Bravo', 4, () => 0)
    const bravoSegments = buildWheelSegments(largePool, 'Alpha', 4, () => 0.99)

    expect(alphaSegments.slice(0, -1).map((segment) => segment.username)).toEqual([
      'Alpha',
      'Alpha',
      'Alpha',
    ])
    expect(bravoSegments.slice(0, -1).map((segment) => segment.username)).toEqual([
      'Bravo',
      'Bravo',
      'Bravo',
    ])
  })

  test('still produces a stable wheel when the entrant snapshot is empty', () => {
    expect(buildWheelSegments([], 'Winner', 24, () => 0.5)).toEqual([
      { username: 'Winner', entryNumber: 1 },
    ])
  })
})

describe('wheelLandingRotation', () => {
  test('lands the center of the selected slice under the top pointer', () => {
    expect(wheelLandingRotation(3, 8, 6)).toBe(2002.5)
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
