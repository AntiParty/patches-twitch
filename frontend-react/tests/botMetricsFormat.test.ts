import { describe, expect, test } from 'bun:test'
import {
  formatAge,
  formatAgo,
  formatBytes,
  formatCount,
  formatMs,
  formatUptime,
} from '../src/features/botmetrics/format'

describe('bot metrics formatters', () => {
  test('missing values render as a dash, never a guessed zero', () => {
    expect(formatUptime(null)).toBe('—')
    expect(formatBytes(null)).toBe('—')
    expect(formatMs(null)).toBe('—')
    expect(formatAge(null)).toBe('—')
    expect(formatCount(null)).toBe('—')
  })

  test('uptime keeps the two largest units', () => {
    expect(formatUptime(45)).toBe('0m')
    expect(formatUptime(2 * 3600 + 5 * 60)).toBe('2h 5m')
    expect(formatUptime(3 * 86_400 + 4 * 3600 + 59)).toBe('3d 4h')
  })

  test('bytes switch to GB at 1024 MB', () => {
    expect(formatBytes(182 * 1_048_576)).toBe('182 MB')
    expect(formatBytes(1.5 * 1024 * 1_048_576)).toBe('1.5 GB')
  })

  test('counts accept the string counts SQLite returns', () => {
    expect(formatCount('1234')).toBe('1,234')
    expect(formatCount(0)).toBe('0')
  })

  test('refresh age and cache age', () => {
    expect(formatAgo(2_000)).toBe('just now')
    expect(formatAgo(12_000)).toBe('12s ago')
    expect(formatAgo(125_000)).toBe('2m ago')
    expect(formatAge(30)).toBe('30s old')
    expect(formatAge(4 * 60 + 10)).toBe('4m old')
    expect(formatAge(2 * 3600)).toBe('2h old')
  })
})
