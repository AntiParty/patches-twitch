/* Pure formatting / filtering helpers shared by the admin views. */
import type { AdminChannel, AuditEvent, OperationalEvent } from '@/types/admin'

export type Tone = 'success' | 'warning' | 'danger'

export const fmt = (n: number) => Number(n).toLocaleString()

export function statusVariant(status: string): Tone {
  const s = status.toLowerCase()
  if (s.includes('outage') || s.includes('down') || s.includes('critical') || s.includes('error')) return 'danger'
  if (s.includes('healthy') || s.includes('ok') || s.includes('operational')) return 'success'
  return 'warning'
}

export function uptime(seconds: number | null): string {
  if (!seconds) return '—'
  const h = Math.floor(seconds / 3600)
  const d = Math.floor(h / 24)
  if (d > 0) return `${d}d ${h % 24}h`
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** Backend treats a leaderboard cache this old (seconds) as stale. */
export const CACHE_STALE_SECONDS = 20 * 60

export function isCacheStale(ageSeconds: number | null | undefined): boolean {
  return ageSeconds != null && ageSeconds >= CACHE_STALE_SECONDS
}

export function relativeTime(ts: string | undefined | null, now: Date = new Date()): string {
  if (!ts) return ''
  const t = new Date(ts).getTime()
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, Math.floor((now.getTime() - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const ACRONYMS: Record<string, string> = {
  irc: 'IRC',
  eventsub: 'EventSub',
  api: 'API',
  rs: 'RS',
  id: 'ID',
  obs: 'OBS',
  url: 'URL',
}

const cased = (w: string) => ACRONYMS[w.toLowerCase()]

/** Title-case a snake/kebab identifier ("reconnect_failed" -> "Reconnect Failed"). */
export function humanize(s: string | null | undefined): string {
  if (!s) return 'Event'
  return s
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w+/g, (w) => cased(w) ?? w.charAt(0).toUpperCase() + w.slice(1))
}

/** Sentence-case an audit action ("user.role_changed" -> "User role changed"). */
export function humanizeAction(s: string | null | undefined): string {
  if (!s) return 'Event'
  const words = s.replace(/[._:/-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
  if (!words) return 'Event'
  const out = words.split(' ').map((w) => cased(w) ?? w)
  if (!cased(out[0].toLowerCase())) out[0] = out[0].charAt(0).toUpperCase() + out[0].slice(1)
  return out.join(' ')
}

export function outcomeVariant(outcome: string): Tone {
  const o = outcome.toLowerCase()
  if (o === 'success' || o === 'ok' || o === 'recovered') return 'success'
  if (o === 'failure' || o === 'failed' || o === 'error') return 'danger'
  return 'warning'
}

/** Split operational events into things worth acting on and routine activity. */
export function splitOperationalEvents(events: OperationalEvent[]): {
  problems: OperationalEvent[]
  activity: OperationalEvent[]
} {
  const problems: OperationalEvent[] = []
  const activity: OperationalEvent[] = []
  for (const e of events) {
    const isProblem = e.outcome
      ? outcomeVariant(e.outcome) !== 'success'
      : e.severity === 'warning' || e.severity === 'critical'
    ;(isProblem ? problems : activity).push(e)
  }
  return { problems, activity }
}

/** Parse an ISO string or a SQLite "YYYY-MM-DD HH:MM:SS" (UTC) timestamp. */
export function parseSqliteUtc(ts: string): Date | null {
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(ts) ? `${ts.replace(' ', 'T')}Z` : ts
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/* ---------- Channels ---------- */

export type ChannelFilter = 'all' | 'enabled' | 'disabled' | 'banned'

export function filterChannels(channels: AdminChannel[], query: string, filter: ChannelFilter): AdminChannel[] {
  const q = query.trim().toLowerCase()
  return channels
    .filter((c) => {
      if (q && !c.username.toLowerCase().includes(q)) return false
      if (filter === 'enabled') return c.botEnabled && !c.banned
      if (filter === 'disabled') return !c.botEnabled
      if (filter === 'banned') return c.banned
      return true
    })
    .sort((a, b) => a.username.localeCompare(b.username))
}

export function channelSummary(channels: AdminChannel[]) {
  return {
    total: channels.length,
    enabled: channels.filter((c) => c.botEnabled).length,
    banned: channels.filter((c) => c.banned).length,
  }
}

/* ---------- Audit ---------- */

export type AuditOutcomeFilter = 'all' | 'success' | 'failed'

export function auditTimestamp(e: AuditEvent): string | undefined {
  return e.timestamp || e.createdAt
}

export function auditOutcomeOf(e: AuditEvent): 'success' | 'failed' | 'unknown' {
  if (!e.outcome) return 'unknown'
  const o = e.outcome.toLowerCase()
  return o === 'success' || o === 'ok' ? 'success' : 'failed'
}

export function filterAudit(events: AuditEvent[], query: string, outcome: AuditOutcomeFilter): AuditEvent[] {
  const q = query.trim().toLowerCase()
  return events.filter((e) => {
    if (outcome !== 'all' && auditOutcomeOf(e) !== outcome) return false
    if (!q) return true
    const hay = [e.action, humanizeAction(e.action), e.target, e.actor].filter(Boolean).join(' ').toLowerCase()
    return hay.includes(q)
  })
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export interface AuditDayGroup {
  key: string
  label: string
  events: AuditEvent[]
}

/** Group events (kept in input order) under local-day headings; undated last. */
export function groupAuditByDay(events: AuditEvent[], now: Date = new Date()): AuditDayGroup[] {
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const groups: AuditDayGroup[] = []
  const byKey = new Map<string, AuditDayGroup>()
  const undated: AuditEvent[] = []
  for (const e of events) {
    const ts = auditTimestamp(e)
    const d = ts ? new Date(ts) : null
    if (!d || Number.isNaN(d.getTime())) {
      undated.push(e)
      continue
    }
    const key = dayKey(d)
    let g = byKey.get(key)
    if (!g) {
      const label =
        key === dayKey(now)
          ? 'Today'
          : key === dayKey(yesterday)
            ? 'Yesterday'
            : d.toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
              })
      g = { key, label, events: [] }
      byKey.set(key, g)
      groups.push(g)
    }
    g.events.push(e)
  }
  if (undated.length) groups.push({ key: 'undated', label: 'Undated', events: undated })
  return groups
}

/* ---------- Commands ---------- */

export interface CommandShare {
  command: string
  count: number
  /** count / top count, for bar width. */
  ratio: number
  /** count / total of all given commands. */
  share: number
}

export function commandShares(commands: { command: string; count: number }[], limit = 12): CommandShare[] {
  const sorted = [...commands].sort((a, b) => b.count - a.count)
  const total = sorted.reduce((s, c) => s + c.count, 0)
  const top = sorted[0]?.count ?? 0
  return sorted.slice(0, limit).map((c) => ({
    command: c.command,
    count: c.count,
    ratio: top > 0 ? c.count / top : 0,
    share: total > 0 ? c.count / total : 0,
  }))
}
