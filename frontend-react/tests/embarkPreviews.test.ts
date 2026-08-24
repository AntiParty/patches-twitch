import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { EmbarkProductPreview } from '../src/features/embark/EmbarkProductPreview'

describe('Embark product previews', () => {
  test('renders a distinct, labelled product interface for every briefing area', () => {
    const previews = [
      ['dashboard', 'Live dashboard'],
      ['chat', 'Twitch chat'],
      ['tracking', 'Live session tracker'],
      ['predictions', 'Prediction control'],
    ] as const

    for (const [kind, label] of previews) {
      const markup = renderToStaticMarkup(createElement(EmbarkProductPreview, { kind }))

      expect(markup).toContain(`aria-label="${label}"`)
      expect(markup).toContain(`data-preview="${kind}"`)
    }
  })

  test('shows the chat command-to-response loop', () => {
    const markup = renderToStaticMarkup(createElement(EmbarkProductPreview, { kind: 'chat' }))

    expect(markup).toContain('!rank antiparty')
    expect(markup).toContain('Ranked update')
    expect(markup).toContain('That climb is unreal')
  })

  test('shows Twitch prediction participation and outcome context', () => {
    const markup = renderToStaticMarkup(createElement(EmbarkProductPreview, { kind: 'predictions' }))

    expect(markup).toContain('Will AntiParty break 44k RS?')
    expect(markup).toContain('2,416 viewers participating')
    expect(markup).toContain('15,820 points committed')
  })

  test('shows live session movement instead of a lifetime rank view', () => {
    const markup = renderToStaticMarkup(createElement(EmbarkProductPreview, { kind: 'tracking' }))

    expect(markup).toContain('Live session')
    expect(markup).toContain('Session change')
    expect(markup).toContain('+482 RS')
  })
})
