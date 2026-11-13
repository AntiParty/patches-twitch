/*
 * Admin → Live operations overview. Status, channel/bot/command stat cards,
 * chat throughput, commands over time, services, things that need attention,
 * and command usage. Consumes /admin/api/operations/overview.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { AreaChart } from '@/components/dither-kit/area-chart'
import { Area } from '@/components/dither-kit/area'
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
import { ProgressBar } from '@/components/data-display/ProgressBar'
import { Select } from '@/components/forms/Select'
import { Spinner } from '@/components/feedback/Spinner'
import { ErrorState } from '@/components/feedback/ErrorState'
import { EmptyState } from '@/components/feedback/EmptyState'
import { adminApi } from '@/api/admin'
import {
  CACHE_STALE_SECONDS,
  commandShares,
  fmt,
  humanize,
  isCacheStale,
  outcomeVariant,
  parseSqliteUtc,
  relativeTime,
  splitOperationalEvents,
  statusVariant,
  uptime,
} from './adminFormat'
import styles from './admin.module.css'

const RANGES = [
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
]
const RANGE_NAME: Record<string, string> = { '24h': 'last 24h', '7d': 'last 7d', '30d': 'last 30d' }

const MAX_INCIDENTS = 8
const MAX_ACTIVITY = 5

const throughputConfig: ChartConfig = {
  in: { label: 'Messages in', color: 'blue' },
  out: { label: 'Messages out', color: 'purple' },
}
const commandsConfig: ChartConfig = {
  commands: { label: 'Commands', color: 'green' },
}

function clock(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function severityVariant(severity: string | undefined): 'danger' | 'warning' | 'default' {
  if (severity === 'critical') return 'danger'
  if (severity === 'warning') return 'warning'
  return 'default'
}

export function Overview() {
  const [range, setRange] = useState('24h')
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'overview', range],
    queryFn: () => adminApi.getOverview(range),
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  })
  // Pending balance changes are an "awaiting you" item; failure just hides the row.
  const balance = useQuery({
    queryKey: ['admin', 'balance'],
    queryFn: adminApi.getBalance,
    staleTime: 5 * 60_000,
    retry: false,
  })

  if (isLoading) return <div className={styles.centered}><Spinner /></div>
  if (isError || !data) return <><PageHeader title="Live operations" /><ErrorState message="Failed to load operations overview." onRetry={() => refetch()} /></>

  const rangeName = RANGE_NAME[range] ?? range
  const pendingBalance = balance.data?.pending.length ?? 0

  // The backend always charts the last 6 hours in 15-minute buckets, regardless of `range`.
  const throughput = data.throughput.map((p) => {
    // timestamp may be epoch ms (as string) or an ISO string — handle both.
    const epoch = Number(p.timestamp)
    const d = Number.isFinite(epoch) && epoch > 0 ? new Date(epoch) : new Date(p.timestamp)
    return { t: isNaN(d.getTime()) ? '' : clock(d), in: p.chatIn, out: p.chatOut }
  })
  // Only chart when there's something meaningful — avoids the flat-line-plus-spike look.
  const hasThroughput = throughput.length >= 3 && throughput.some((p) => p.in > 0 || p.out > 0)

  // Hourly command counts across the selected range.
  const trend = data.commands.trend.flatMap((p) => {
    const d = parseSqliteUtc(p.timestamp)
    if (!d) return []
    return [{
      t: range === '24h' ? clock(d) : d.toLocaleDateString([], { month: 'short', day: 'numeric' }),
      at: d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      commands: p.commands,
    }]
  })
  const hasTrend = trend.length >= 3 && trend.some((p) => p.commands > 0)

  const split = splitOperationalEvents(data.incidents)
  const problems = split.problems.slice(0, MAX_INCIDENTS)
  const activity = split.activity.slice(0, MAX_ACTIVITY)
  const allClear = problems.length === 0 && pendingBalance === 0
  const cacheAge = data.services.cacheAgeSeconds
  const cacheStale = isCacheStale(cacheAge)
  const shares = commandShares(data.commands.activeCommands, 12)

  return (
    <>
      <PageHeader
        title="Live operations"
        subtitle={`Observed ${new Date(data.observedAt).toLocaleTimeString()}`}
        actions={
          <>
            <div className={styles.rangeSelect}>
              <Select aria-label="Time range" value={range} onChange={(e) => setRange(e.target.value)} options={RANGES} />
            </div>
            <Badge variant={statusVariant(data.status)} dot>{data.status}</Badge>
          </>
        }
      />

      <div className={styles.statGrid}>
        <StatCard label="Channels connected" value={fmt(data.channels.connected)} hint={`of ${fmt(data.channels.expected)} expected`} icon="fas fa-tv" to="/admin/channels" />
        <StatCard label="Reconnecting" value={fmt(data.channels.reconnecting)} icon="fas fa-rotate" tone={data.channels.reconnecting > 0 ? 'warning' : undefined} to="/admin/health" />
        <StatCard
          label="Control API"
          value={data.bot.controlApiReachable ? 'Reachable' : 'Down'}
          hint={data.bot.latencyMs != null ? `${data.bot.latencyMs}ms` : ''}
          icon="fas fa-heart-pulse"
          tone={data.bot.controlApiReachable ? undefined : 'danger'}
          to="/admin/health"
        />
        <StatCard label="Bot uptime" value={uptime(data.bot.uptimeSeconds)} icon="fas fa-clock" to="/admin/health" />
        <StatCard label="Commands today" value={fmt(data.commands.today)} hint={`${fmt(data.commands.rangedTotal)} in ${rangeName}`} icon="fas fa-terminal" />
        <StatCard
          label="Failure rate"
          value={`${data.commands.failureRate}%`}
          hint={`${fmt(data.commands.failures)} failed, ${rangeName}`}
          icon="fas fa-triangle-exclamation"
          tone={data.commands.failureRate > 5 ? 'danger' : undefined}
        />
      </div>

      <div className={styles.opColumns}>
        <div className={styles.opStack}>
          <Card title="Chat throughput" subtitle="Messages in / out, last 6 hours (15-minute buckets)">
            <div className={styles.chartBox}>
              {hasThroughput ? (
                <AreaChart data={throughput} config={throughputConfig} bloom="aura">
                  <Grid />
                  <XAxis dataKey="t" />
                  <YAxis />
                  <Legend isClickable />
                  <Tooltip labelKey="t" />
                  <Area dataKey="in" />
                  <Area dataKey="out" />
                </AreaChart>
              ) : (
                <EmptyState icon="fas fa-chart-line" title="Waiting for chat activity" description="Throughput appears once the bot starts processing messages." />
              )}
            </div>
          </Card>

          <Card title="Commands over time" subtitle={`Commands per hour, ${rangeName}`}>
            <div className={styles.chartBox}>
              {hasTrend ? (
                <AreaChart data={trend} config={commandsConfig} bloom="low">
                  <Grid />
                  <XAxis dataKey="t" maxTicks={6} />
                  <YAxis />
                  <Tooltip labelKey="at" />
                  <Area dataKey="commands" />
                </AreaChart>
              ) : (
                <EmptyState icon="fas fa-chart-line" title="Not enough command activity" description="The chart appears once there are a few hours of commands." />
              )}
            </div>
          </Card>
        </div>
        <div className={styles.opStack}>
          <Card title="Needs attention" subtitle="Awaiting you, and recent problems">
            {allClear ? (
              <p className={styles.quietLine}>Nothing needs you right now</p>
            ) : (
              <div className={styles.attentionList}>
                {pendingBalance > 0 && (
                  <Link to="/admin/balance" className={`${styles.attentionRow} ${styles.attentionLink}`}>
                    <span className={styles.auditAction}>
                      {fmt(pendingBalance)} balance {pendingBalance === 1 ? 'change' : 'changes'} to review
                    </span>
                    <Badge variant="warning">Pending</Badge>
                  </Link>
                )}
                {problems.map((e, i) => {
                  const when = relativeTime(e.timestamp)
                  const variant = e.outcome ? outcomeVariant(e.outcome) : severityVariant(e.severity)
                  return (
                    <div className={styles.attentionRow} key={e.id ?? i}>
                      <span>
                        <span className={styles.auditAction}>{humanize(e.type)}</span>
                        {e.channel && <span className={styles.auditMeta}> · {e.channel}</span>}
                        {e.reasonCode && <span className={styles.auditMeta}> · {humanize(e.reasonCode)}</span>}
                        {when && <span className={styles.auditMeta}> · {when}</span>}
                      </span>
                      {(e.outcome || e.severity) && <Badge variant={variant}>{e.outcome ?? e.severity}</Badge>}
                    </div>
                  )
                })}
              </div>
            )}
            {activity.length > 0 && (
              <div className={styles.activitySection}>
                <h3 className={styles.activityHeading}>Recent activity</h3>
                <ul className={styles.activityList}>
                  {activity.map((e, i) => {
                    const when = relativeTime(e.timestamp)
                    const detail = e.channel ?? (e.reasonCode ? humanize(e.reasonCode) : null)
                    return (
                      <li className={styles.activityRow} key={e.id ?? i}>
                        <span className={styles.activityLabel}>
                          {humanize(e.type)}
                          {detail && <span className={styles.auditMeta}> · {detail}</span>}
                        </span>
                        {when && <span className={styles.activityTime}>{when}</span>}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            <Link to="/admin/audit" className={styles.cardFooterLink}>View audit log</Link>
          </Card>

          <Card title="Services" subtitle="Dependencies the bot relies on">
            <div className={styles.serviceList}>
              <div className={styles.serviceRow}>
                <span>EventSub conduit</span>
                <Badge variant={data.services.eventSubHealthy ? 'success' : 'danger'} dot>
                  {data.services.eventSubHealthy ? 'OK' : 'Problem'}
                </Badge>
              </div>
              <div className={styles.serviceRow}>
                <span>Leaderboard cache</span>
                <span className={styles.sideGroup}>
                  {cacheAge != null && <span className={styles.serviceDetail}>{Math.floor(cacheAge / 60)}m old</span>}
                  <Badge variant={cacheAge == null || cacheStale ? 'warning' : 'success'} dot>
                    {cacheAge == null ? 'Unknown' : cacheStale ? `Stale (${Math.round(CACHE_STALE_SECONDS / 60)}m+)` : 'Fresh'}
                  </Badge>
                </span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <Card title="Active commands" subtitle={`Top ${shares.length || 12} by usage, ${rangeName}`} className={styles.sectionGap}>
        {shares.length === 0 ? (
          <EmptyState icon="fas fa-terminal" title="No command activity" />
        ) : (
          <div className={styles.commandList}>
            {shares.map((c) => (
              <div className={styles.commandRow} key={c.command}>
                <code>!{c.command}</code>
                <ProgressBar value={c.ratio * 100} />
                <span className={styles.commandCount}>{fmt(c.count)} · {Math.round(c.share * 100)}%</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  )
}
