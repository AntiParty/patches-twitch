import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { EmbarkProductPreview } from '../src/features/embark/EmbarkProductPreview'

describe('Embark product previews', () => {
  test('renders a distinct, labelled product interface for every briefing area', () => {
    const previews = [
      ['dashboard', 'Live dashboard'],
      ['chat', 'Twitch chat'],
      ['tracking', 'Rank progression'],
      ['predictions', 'Prediction control'],
    ] as const

    for (const [kind, label] of previews) {
      const markup = renderToStaticMarkup(createElement(EmbarkProductPreview, { kind }))

      expect(markup).toContain(`aria-label="${label}"`)
      expect(markup).toContain(`data-preview="${kind}"`)
    }
  })
})
