import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { EmbarkAsk, EmbarkCapabilities } from '../src/features/embark/EmbarkSections'
import { embarkComparison, embarkProposals, embarkCapabilities } from '../src/features/embark/embarkBriefing'

describe('Embark ask and capability sections', () => {
  test('renders the today versus official data comparison', () => {
    const markup = renderToStaticMarkup(createElement(EmbarkAsk))

    expect(markup).toContain('aria-labelledby="how-title"')
    expect(markup).toContain('<table')
    for (const row of embarkComparison) {
      expect(markup).toContain(row.topic)
    }
  })

  test('renders every proposal under the ask heading', () => {
    const markup = renderToStaticMarkup(createElement(EmbarkAsk))

    expect(markup).toContain('aria-labelledby="ask-title"')
    for (const proposal of embarkProposals) expect(markup).toContain(proposal.title)
  })

  test('renders See it live links for public routes', () => {
    const markup = renderToStaticMarkup(createElement(EmbarkCapabilities))

    for (const capability of embarkCapabilities) {
      expect(markup).toContain(capability.title)
      if (capability.href) expect(markup).toContain(`href="${capability.href}"`)
    }
  })
})
