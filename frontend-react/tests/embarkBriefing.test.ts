import { describe, expect, test } from 'bun:test'

describe('Embark briefing content', () => {
  test('keeps the partnership briefing factual and ready for real metrics', async () => {
    const briefing = await import('../src/features/embark/embarkBriefing')

    expect('embarkMetrics' in briefing).toBe(false)
    expect(briefing.embarkCapabilities).toHaveLength(6)
    expect(briefing.embarkContact.email).toBe('partnerships@finalsrs.com')
    expect(briefing.embarkContact.x).toBe('https://x.com/AntipartyGG')
  })

  test('every capability says what it does and links only to on-site routes', async () => {
    const { embarkCapabilities } = await import('../src/features/embark/embarkBriefing')

    for (const capability of embarkCapabilities) {
      expect(capability.title.trim().length).toBeGreaterThan(0)
      expect(capability.description.trim().length).toBeGreaterThan(0)
      if (capability.href !== undefined) {
        expect(capability.href.startsWith('/')).toBe(true)
        expect(capability.hrefLabel?.trim().length).toBeGreaterThan(0)
      }
    }
    expect(embarkCapabilities.filter((c) => c.href).length).toBeGreaterThanOrEqual(4)
  })

  test('compares today with official data and lists three concrete proposals', async () => {
    const { embarkComparison, embarkProposals, embarkGallery } = await import(
      '../src/features/embark/embarkBriefing'
    )

    expect(embarkComparison.length).toBeGreaterThanOrEqual(2)
    expect(embarkComparison.length).toBeLessThanOrEqual(4)
    for (const row of embarkComparison) {
      expect(row.topic && row.today && row.withOfficialData).toBeTruthy()
    }
    expect(embarkProposals).toHaveLength(3)
    for (const proposal of embarkProposals) {
      expect(proposal.title.length).toBeGreaterThan(0)
      expect(proposal.description.length).toBeGreaterThan(0)
    }
    expect(embarkGallery).toHaveLength(4)
  })
})
