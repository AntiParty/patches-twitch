/* Display formatters for the bot metrics page. A missing value renders as "—". */

const DASH = '—'

export function formatCount(n: number | string | null | undefined): string {
  if (n == null || n === '') return DASH
  return Number(n).toLocaleString('en-US')
}

export function formatUptime(seconds: number | null): string {
  if (seconds == null) return DASH
  const d = Math.floor(seconds / 86_400)
  const h = Math.floor((seconds % 86_400) / 3_600)
  const m = Math.floor((seconds % 3_600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function formatBytes(bytes: number | null): string {
  if (bytes == null) return DASH
  const mb = bytes / 1_048_576
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`
}

export function formatMs(ms: number | null): string {
  return ms == null ? DASH : `${Math.round(ms)} ms`
}

/** "just now" / "12s ago" / "3m ago" for the time since the last refresh. */
export function formatAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  return `${Math.floor(s / 60)}m ago`
}

/** Age of the leaderboard cache, e.g. "4m old". */
export function formatAge(seconds: number | null): string {
  if (seconds == null) return DASH
  if (seconds < 60) return `${Math.round(seconds)}s old`
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m old`
  return `${Math.floor(seconds / 3_600)}h old`
}
