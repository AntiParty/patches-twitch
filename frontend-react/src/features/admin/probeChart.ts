/* Chart grouping + formatting for Admin → Probes. Pure, unit tested. */
import type { ProbeReport } from '@/types/admin'

/** Stacked chart series: the two recent PHP CVE families, then the rest. */
export const PROBE_GROUPS = {
  php2shell: ['php2shell'],
  cgi: ['php-cgi-injection'],
  php: ['phpunit', 'phpinfo', 'wordpress', 'db-admin', 'php-other'],
  other: ['secrets', 'other-scanner'],
} as const

export type ProbeGroup = keyof typeof PROBE_GROUPS

const GROUP_OF: Record<string, ProbeGroup> = Object.fromEntries(
  (Object.keys(PROBE_GROUPS) as ProbeGroup[]).flatMap((g) => PROBE_GROUPS[g].map((c) => [c, g])),
)

export function groupOf(category: string): ProbeGroup {
  return GROUP_OF[category] ?? 'other'
}

export function probeChartRows(series: ProbeReport['series']) {
  return series.map((d) => {
    const row = { t: shortDay(d.day), at: d.day, php2shell: 0, cgi: 0, php: 0, other: 0 }
    for (const [category, count] of Object.entries(d.byCategory)) row[groupOf(category)] += count
    return row
  })
}

/** "2026-10-22" → "Oct 22" (UTC day keys, so format in UTC). */
export function shortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** Long query strings and paths stay on one line in tables. */
export function truncateMiddle(value: string, max = 72): string {
  if (value.length <= max) return value
  const keep = max - 1
  return `${value.slice(0, Math.ceil(keep * 0.7))}…${value.slice(value.length - Math.floor(keep * 0.3))}`
}
