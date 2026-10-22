import { describe, expect, test } from 'bun:test'
import { groupOf, probeChartRows, shortDay, truncateMiddle } from '../src/features/admin/probeChart'

describe('probe chart helpers', () => {
  test('groups categories into the four chart series', () => {
    expect(groupOf('php2shell')).toBe('php2shell')
    expect(groupOf('php-cgi-injection')).toBe('cgi')
    expect(groupOf('wordpress')).toBe('php')
    expect(groupOf('secrets')).toBe('other')
    expect(groupOf('something-new')).toBe('other')
  })

  test('sums categories per day', () => {
    const rows = probeChartRows([
      { day: '2026-10-21', total: 0, byCategory: {} },
      { day: '2026-10-22', total: 9, byCategory: { php2shell: 2, 'php-other': 3, wordpress: 1, secrets: 3 } },
    ])
    expect(rows[0]).toEqual({ t: 'Oct 21', at: '2026-10-21', php2shell: 0, cgi: 0, php: 0, other: 0 })
    expect(rows[1]).toMatchObject({ php2shell: 2, cgi: 0, php: 4, other: 3 })
  })

  test('formats UTC day keys without shifting the date', () => {
    expect(shortDay('2026-01-01')).toBe('Jan 1')
  })

  test('truncates long paths in the middle', () => {
    expect(truncateMiddle('/short')).toBe('/short')
    const long = '/?-d+allow_url_include%3d1+-d+auto_prepend_file%3dphp://input' + 'x'.repeat(50)
    const out = truncateMiddle(long, 40)
    expect(out.length).toBe(40)
    expect(out.startsWith('/?-d+allow_url')).toBe(true)
    expect(out).toContain('…')
  })
})
