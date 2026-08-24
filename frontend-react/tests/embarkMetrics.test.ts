import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { EmbarkMetrics } from '../src/features/embark/EmbarkMetrics'

describe('Embark metrics', () => {
  test('explains when live totals are temporarily unavailable', () => {
    const markup = renderToStaticMarkup(
      createElement(EmbarkMetrics, {
        status: 'error',
        stats: undefined,
      }),
    )

    expect(markup).toContain('Live totals are temporarily unavailable.')
    expect(markup).not.toContain('>—<')
  })

  test('labels the available totals as lifetime measurements', () => {
    const markup = renderToStaticMarkup(
      createElement(EmbarkMetrics, {
        status: 'success',
        stats: {
          streamers: 12,
          commandsProcessed: 3456,
          predictionsCreated: 78,
          apiRequests: 90,
        },
      }),
    )

    expect(markup).toContain('Lifetime platform totals')
    expect(markup).toContain('3,456')
  })
})
