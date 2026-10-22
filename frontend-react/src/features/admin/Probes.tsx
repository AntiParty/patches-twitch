/*
 * Admin → Probes. Vulnerability-scanner traffic (PHP exploits, WordPress,
 * secrets, etc.) seen by the web server. Watch-only: the site runs no PHP, so
 * these requests can't succeed. Consumes /admin/api/operations/probes.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart } from '@/components/dither-kit/bar-chart'
import { Bar } from '@/components/dither-kit/bar'
import { Grid } from '@/components/dither-kit/grid'
import { XAxis } from '@/components/dither-kit/x-axis'
import { YAxis } from '@/components/dither-kit/y-axis'
import { Legend } from '@/components/dither-kit/legend'
import { Tooltip } from '@/components/dither-kit/tooltip'
import type { ChartConfig } from '@/components/dither-kit/chart-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/cards/Card'
import { StatCard } from '@/components/cards/StatCard'
import { Badge } from '@/components/data-display/Badge'
import { Select } from '@/components/forms/Select'
import { Spinner } from '@/components/feedback/Spinner'
import { ErrorState } from '@/components/feedback/ErrorState'
import { EmptyState } from '@/components/feedback/EmptyState'
import { adminApi } from '@/api/admin'
import type { ProbeReport } from '@/types/admin'
import { groupOf, probeChartRows, shortDay, truncateMiddle } from './probeChart'
import styles from './admin.module.css'

const RANGES = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '365d', label: '1 year' },
]

const chartConfig: ChartConfig = {
  php2shell: { label: 'php2shell', color: 'red' },
  cgi: { label: 'PHP-CGI injection', color: 'orange' },
  php: { label: 'Other PHP', color: 'purple' },
  other: { label: 'Non-PHP', color: 'blue' },
}

const GROUP_BADGE = { php2shell: 'danger', cgi: 'warning', php: 'primary', other: 'default' } as const

const fmt = (n: number) => n.toLocaleString()

function CategoryBadge({ category, labels }: { category: string; labels: Map<string, string> }) {
  return <Badge variant={GROUP_BADGE[groupOf(category)]}>{labels.get(category) ?? category}</Badge>
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

export function Probes() {
  const [range, setRange] = useState('7d')
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'probes', range],
    queryFn: () => adminApi.getProbes(range),
    refetchInterval: 60_000,
  })

  return (
    <>
      <PageHeader
        title="Scanner Probes"
        subtitle="Requests probing for PHP and other exploits. The site runs no PHP, so none of these can succeed."
        actions={
          <div style={{ width: 160 }}>
            <Select value={range} onChange={(e) => setRange(e.target.value)} options={RANGES} />
          </div>
        }
      />

      {isLoading ? (
        <div style={{ display: 'grid', placeItems: 'center', padding: 60 }}><Spinner /></div>
      ) : isError || !data ? (
        <ErrorState message="Failed to load probe report." onRetry={() => refetch()} />
      ) : (
        <ProbeReportView data={data} />
      )}
    </>
  )
}

function ProbeReportView({ data }: { data: ProbeReport }) {
  const labels = new Map(data.categories.map((c) => [c.category, c.label]))
  const count = (category: string) => data.categories.find((c) => c.category === category)?.count ?? 0
  const detailNote = data.detailDays < data.days ? `last ${data.detailDays} days` : `last ${data.days} days`
  const rows = probeChartRows(data.series)

  return (
    <>
      <div className={styles.statGrid}>
        <StatCard label="Probe requests" value={fmt(data.totals.requests)} hint={`last ${data.days} days`} icon="fas fa-bug" />
        <StatCard label="Today (UTC)" value={fmt(data.totals.today)} icon="fas fa-calendar-day" />
        <StatCard label="Distinct sources" value={fmt(data.totals.sources)} hint={detailNote} icon="fas fa-network-wired" />
        <StatCard label="php2shell" value={fmt(count('php2shell'))} hint="CVE-2026-109618/9" icon="fas fa-triangle-exclamation" />
        <StatCard label="PHP-CGI injection" value={fmt(count('php-cgi-injection'))} hint="CVE-2024-4577" icon="fas fa-terminal" />
      </div>

      <Card title="Probes per day" subtitle="UTC days, stacked by family">
        <div style={{ height: 240 }}>
          {data.totals.requests === 0 ? (
            <EmptyState icon="fas fa-shield-halved" title="No probes recorded in this range" />
          ) : (
            <BarChart data={rows} config={chartConfig} stackType="stacked">
              <Grid />
              <XAxis dataKey="t" maxTicks={8} />
              <YAxis />
              <Legend isClickable />
              <Tooltip labelKey="at" />
              <Bar dataKey="php2shell" />
              <Bar dataKey="cgi" />
              <Bar dataKey="php" />
              <Bar dataKey="other" />
            </BarChart>
          )}
        </div>
      </Card>

      <div className={styles.probeGrid}>
        <Card title="By category" subtitle={`Requests over ${data.days} days · sources over ${detailNote}`}>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Category</th><th className={styles.num}>Requests</th><th className={styles.num}>Sources</th></tr></thead>
              <tbody>
                {data.categories.map((c) => (
                  <tr key={c.category}>
                    <td>
                      <CategoryBadge category={c.category} labels={labels} />
                      {c.reference && <div className={styles.subtle}>{c.reference}</div>}
                    </td>
                    <td className={styles.num}>{fmt(c.count)}</td>
                    <td className={styles.num}>{fmt(c.sources)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Top sources" subtitle={`Truncated IPs, ${detailNote}`}>
          {data.topSources.length === 0 ? (
            <EmptyState icon="fas fa-network-wired" title="No sources yet" />
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Source</th><th className={styles.num}>Requests</th><th>Probing for</th><th>Last seen</th></tr></thead>
                <tbody>
                  {data.topSources.map((s) => (
                    <tr key={s.sourceHash}>
                      <td style={{ whiteSpace: 'nowrap' }}><code className={styles.mono} title={`hash ${s.sourceHash}`}>{s.sourcePrefix ?? 'unknown'}</code></td>
                      <td className={styles.num}>{fmt(s.count)}</td>
                      <td><div className={styles.chipRow}>{s.categories.map((c) => <CategoryBadge key={c} category={c} labels={labels} />)}</div></td>
                      <td className={styles.subtle}>{shortDay(s.lastDay)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card title="Top paths" subtitle={detailNote}>
        {data.topPaths.length === 0 ? (
          <EmptyState icon="fas fa-route" title="No paths yet" />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Path</th><th>Category</th><th className={styles.num}>Requests</th><th>Last seen</th></tr></thead>
              <tbody>
                {data.topPaths.map((p) => (
                  <tr key={`${p.category}:${p.path}`}>
                    <td><code className={styles.mono} title={p.path}>{truncateMiddle(p.path)}</code></td>
                    <td><CategoryBadge category={p.category} labels={labels} /></td>
                    <td className={styles.num}>{fmt(p.count)}</td>
                    <td className={styles.subtle}>{shortDay(p.lastDay)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Recent examples" subtitle="Latest 50 of up to 500 kept">
        {data.recent.length === 0 ? (
          <EmptyState icon="fas fa-list" title="No examples yet" />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Time</th><th>Request</th><th>Category</th><th className={styles.num}>Status</th><th>Source</th><th>User agent</th></tr></thead>
              <tbody>
                {data.recent.map((r, i) => (
                  <tr key={i}>
                    <td className={styles.subtle} style={{ whiteSpace: 'nowrap' }}>{timeOf(r.timestamp)}</td>
                    <td>
                      <code className={styles.mono} title={r.url}>{r.method} {truncateMiddle(r.url, 60)}</code>
                      <div className={styles.subtle}>rule: {r.rule}</div>
                    </td>
                    <td><CategoryBadge category={r.category} labels={labels} /></td>
                    <td className={styles.num}>{r.statusCode ?? '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}><code className={styles.mono}>{r.sourcePrefix ?? 'unknown'}</code></td>
                    <td className={styles.subtle} title={r.userAgent ?? ''}>{r.userAgent ? truncateMiddle(r.userAgent, 40) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
