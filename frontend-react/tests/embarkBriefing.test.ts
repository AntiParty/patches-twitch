import { describe, expect, test } from 'bun:test'

describe('Embark briefing content', () => {
  test('keeps the partnership briefing factual and ready for real metrics', async () => {
    const briefing = await import('../src/features/embark/embarkBriefing')

    expect(briefing.embarkMetrics).toEqual([
      { value: '[X]', label: 'Streamers' },
      { value: '[X]', label: 'Commands processed' },
      { value: '[X]', label: 'Predictions created' },
      { value: '[X]', label: 'API requests' },
    ])
    expect(briefing.embarkCapabilities).toHaveLength(6)
    expect(briefing.embarkContact.email).toBe('your-email@example.com')
  })
})
