import { describe, expect, test } from 'bun:test'
import { canShowGiveawayRollPreview, createGiveawayRollPreview } from '../src/features/dashboard/giveawayPreview'

describe('giveaway roll preview', () => {
  test('creates a deterministic local 200-user pool with a valid saved winner', () => {
    const preview = createGiveawayRollPreview(200)

    expect(preview.entrants).toHaveLength(200)
    expect(new Set(preview.entrants.map((entrant) => entrant.userId)).size).toBe(200)
    expect(preview.entrants.some((entrant) => entrant.username === preview.winner)).toBe(true)
    expect(preview.slot).toBeGreaterThan(0)
    expect(preview.slot).toBeLessThanOrEqual(preview.total)
  })

  test('allows the local preview for the backend-served localhost dashboard', () => {
    expect(canShowGiveawayRollPreview(false, 'localhost')).toBe(true)
    expect(canShowGiveawayRollPreview(false, '127.0.0.1')).toBe(true)
    expect(canShowGiveawayRollPreview(false, 'dashboard.example.com')).toBe(false)
  })
})
