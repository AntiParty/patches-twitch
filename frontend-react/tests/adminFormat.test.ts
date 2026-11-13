import { describe, expect, test } from 'bun:test'
import {
  auditOutcomeOf,
  commandShares,
  filterAudit,
  filterChannels,
  channelSummary,
  groupAuditByDay,
  humanize,
  humanizeAction,
  splitOperationalEvents,
  parseSqliteUtc,
  relativeTime,
  statusVariant,
  uptime,
  isCacheStale,
} from '../src/features/admin/adminFormat'

const NOW = new Date('2026-11-13T12:00:00')

describe('relativeTime', () => {
  test('formats recent offsets', () => {
    expect(relativeTime(new Date(NOW.getTime() - 20_000).toISOString(), NOW)).toBe('just now')
    expect(relativeTime(new Date(NOW.getTime() - 12 * 60_000).toISOString(), NOW)).toBe('12m ago')
    expect(relativeTime(new Date(NOW.getTime() - 3 * 3600_000).toISOString(), NOW)).toBe('3h ago')
    expect(relativeTime(new Date(NOW.getTime() - 50 * 3600_000).toISOString(), NOW)).toBe('2d ago')
  })
  test('handles missing, invalid and future values', () => {
    expect(relativeTime(undefined, NOW)).toBe('')
    expect(relativeTime('garbage', NOW)).toBe('')
    expect(relativeTime(new Date(NOW.getTime() + 60_000).toISOString(), NOW)).toBe('just now')
  })
})

describe('uptime / status', () => {
  test('formats uptime', () => {
    expect(uptime(null)).toBe('—')
    expect(uptime(0)).toBe('—')
    expect(uptime(45 * 60)).toBe('45m')
    expect(uptime(3 * 3600 + 5 * 60)).toBe('3h 5m')
    expect(uptime(26 * 3600)).toBe('1d 2h')
  })
  test('maps status words to variants', () => {
    expect(statusVariant('healthy')).toBe('success')
    expect(statusVariant('degraded')).toBe('warning')
    expect(statusVariant('down')).toBe('danger')
  })
  test('maps every status computeOperationsStatus can return', () => {
    expect(statusVariant('operational')).toBe('success')
    expect(statusVariant('degraded')).toBe('warning')
    expect(statusVariant('outage')).toBe('danger')
    expect(statusVariant('Major Outage')).toBe('danger')
  })
  test('cache is stale at 20 minutes or more', () => {
    expect(isCacheStale(1199)).toBe(false)
    expect(isCacheStale(1200)).toBe(true)
    expect(isCacheStale(null)).toBe(false)
  })
})

describe('humanizeAction', () => {
  test('sentence-cases separators', () => {
    expect(humanizeAction('user.role_changed')).toBe('User role changed')
    expect(humanizeAction('balance-approve')).toBe('Balance approve')
    expect(humanizeAction('')).toBe('Event')
    expect(humanizeAction(undefined)).toBe('Event')
  })
})

describe('channels', () => {
  const channels = [
    { id: 1, username: 'Alpha', role: 'admin', botEnabled: true, banned: false },
    { id: 2, username: 'beta', role: '', botEnabled: false, banned: false },
    { id: 3, username: 'gamma', role: 'tester', botEnabled: true, banned: true },
  ]
  test('filters by query and status, sorted by name', () => {
    expect(filterChannels(channels, '', 'all').map((c) => c.id)).toEqual([1, 2, 3])
    expect(filterChannels(channels, 'ALP', 'all').map((c) => c.id)).toEqual([1])
    expect(filterChannels(channels, '', 'enabled').map((c) => c.id)).toEqual([1])
    expect(filterChannels(channels, '', 'disabled').map((c) => c.id)).toEqual([2])
    expect(filterChannels(channels, '', 'banned').map((c) => c.id)).toEqual([3])
    expect(filterChannels(channels, 'zzz', 'all')).toEqual([])
  })
  test('summarises counts', () => {
    expect(channelSummary(channels)).toEqual({ total: 3, enabled: 2, banned: 1 })
  })
})

describe('audit', () => {
  const at = (h: number, dayOffset = 0) => {
    const d = new Date(NOW)
    d.setDate(d.getDate() - dayOffset)
    d.setHours(h, 0, 0, 0)
    return d.toISOString()
  }
  const events = [
    { action: 'a.one', timestamp: at(10), actor: 'Ann', outcome: 'success' },
    { action: 'b.two', createdAt: at(9), target: 'Chan', outcome: 'failure' },
    { action: 'c.three', timestamp: at(9, 1), outcome: 'success' },
    { action: 'd.four' },
  ]
  test('groups by day with Today/Yesterday labels, undated last', () => {
    const groups = groupAuditByDay(events, NOW)
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', 'Undated'])
    expect(groups[0].events.length).toBe(2)
    expect(groups[2].events[0].action).toBe('d.four')
  })
  test('uses a date label for older days', () => {
    const groups = groupAuditByDay([{ action: 'x', timestamp: at(9, 5) }], NOW)
    expect(groups[0].label).not.toBe('Today')
    expect(groups[0].label).toContain('Nov')
  })
  test('filters by text and outcome', () => {
    expect(filterAudit(events, 'ann', 'all').length).toBe(1)
    expect(filterAudit(events, 'chan', 'all').length).toBe(1)
    expect(filterAudit(events, 'one', 'all').length).toBe(1)
    expect(filterAudit(events, '', 'failed').map((e) => e.action)).toEqual(['b.two'])
    expect(filterAudit(events, '', 'success').length).toBe(2)
  })
  test('outcome classification', () => {
    expect(auditOutcomeOf({ action: 'x', outcome: 'success' })).toBe('success')
    expect(auditOutcomeOf({ action: 'x', outcome: 'failure' })).toBe('failed')
    expect(auditOutcomeOf({ action: 'x' })).toBe('unknown')
  })
})

describe('commandShares', () => {
  test('sorts, caps and computes proportions of the top command', () => {
    const out = commandShares(
      [
        { command: 'a', count: 10 },
        { command: 'b', count: 40 },
        { command: 'c', count: 50 },
      ],
      2,
    )
    expect(out.map((c) => c.command)).toEqual(['c', 'b'])
    expect(out[0].ratio).toBe(1)
    expect(out[1].ratio).toBeCloseTo(0.8)
    expect(out[0].share).toBeCloseTo(0.5)
  })
  test('handles empty and zero totals', () => {
    expect(commandShares([], 5)).toEqual([])
    expect(commandShares([{ command: 'a', count: 0 }], 5)[0].ratio).toBe(0)
  })
})

describe('parseSqliteUtc', () => {
  test('parses SQLite day-hour stamps as UTC', () => {
    expect(parseSqliteUtc('2026-11-13 04:00:00')?.toISOString()).toBe('2026-11-13T04:00:00.000Z')
    expect(parseSqliteUtc('2026-11-13T04:00:00Z')?.toISOString()).toBe('2026-11-13T04:00:00.000Z')
    expect(parseSqliteUtc('nope')).toBeNull()
  })
})

describe('acronym casing', () => {
  test('humanize keeps known acronyms and brand casing', () => {
    expect(humanize('eventsub_connected')).toBe('EventSub Connected')
    expect(humanize('irc_connected')).toBe('IRC Connected')
    expect(humanize('cache_refresh_succeeded')).toBe('Cache Refresh Succeeded')
    expect(humanize('api-url-id')).toBe('API URL ID')
    expect(humanize('obs_rs_reconnect')).toBe('OBS RS Reconnect')
    expect(humanize(null)).toBe('Event')
  })
  test('humanizeAction sentence-cases but keeps acronyms', () => {
    expect(humanizeAction('irc.reconnected')).toBe('IRC reconnected')
    expect(humanizeAction('channel.eventsub_revoked')).toBe('Channel EventSub revoked')
    expect(humanizeAction('user.id_changed')).toBe('User ID changed')
    expect(humanizeAction('eventsub.connected')).toBe('EventSub connected')
  })
})

describe('splitOperationalEvents', () => {
  test('separates problems from activity', () => {
    const events = [
      { type: 'a', outcome: 'success' },
      { type: 'b', outcome: 'failed' },
      { type: 'c', outcome: 'recovered' },
      { type: 'd', outcome: 'timeout' },
      { type: 'e', severity: 'warning' as const },
      { type: 'f', severity: 'critical' as const },
      { type: 'g', severity: 'info' as const },
      { type: 'h' },
      { type: 'i', outcome: 'success', severity: 'critical' as const },
    ]
    const { problems, activity } = splitOperationalEvents(events)
    expect(problems.map((e) => e.type)).toEqual(['b', 'd', 'e', 'f'])
    expect(activity.map((e) => e.type)).toEqual(['a', 'c', 'g', 'h', 'i'])
  })
  test('handles empty input', () => {
    expect(splitOperationalEvents([])).toEqual({ problems: [], activity: [] })
  })
})
