import { describe, expect, test } from 'bun:test'
import { formatWatchTime } from '../src/features/drops/dropDuration'

describe('drop watch time', () => {
  test('singularizes units of one', () => {
    expect(formatWatchTime('1 hours')).toBe('Watch 1 hour')
    expect(formatWatchTime('1 minutes')).toBe('Watch 1 minute')
  })

  test('keeps plural units', () => {
    expect(formatWatchTime('2 hours')).toBe('Watch 2 hours')
    expect(formatWatchTime('30 minutes')).toBe('Watch 30 minutes')
  })

  test('leaves other formats alone', () => {
    expect(formatWatchTime('90m')).toBe('Watch 90m')
    expect(formatWatchTime('  1 Hours ')).toBe('Watch 1 Hour')
  })
})
