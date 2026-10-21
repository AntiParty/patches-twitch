import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextCheck, formatCountdown } from '../src/features/leaderboard/NextCheck'

const NOW = Date.parse('2026-10-21T17:00:00Z')

function render(nextCheckAt: string | null) {
  return renderToStaticMarkup(createElement(NextCheck, { nextCheckAt, now: NOW }))
}

describe('leaderboard next-check countdown', () => {
  test('formats minutes and zero-padded seconds', () => {
    expect(formatCountdown(6 * 60_000 + 12_000)).toBe('6:12')
    expect(formatCountdown(15 * 60_000)).toBe('15:00')
    expect(formatCountdown(1)).toBe('0:01')
    expect(formatCountdown(-5000)).toBe('0:00')
  })

  test('counts down to the next scheduled check', () => {
    expect(render('2026-10-21T17:06:12Z')).toContain('Next check in 6:12')
  })

  test('says it is checking once the time has passed', () => {
    expect(render('2026-10-21T16:59:00Z')).toContain('Checking for new standings…')
  })

  test('renders nothing before the bot has polled or for a bad timestamp', () => {
    expect(render(null)).toBe('')
    expect(render('not-a-date')).toBe('')
  })
})
