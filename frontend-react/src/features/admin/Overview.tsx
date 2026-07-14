/*
 * Admin → Live operations overview. Status, channel/bot/command stat cards,
 * chat throughput chart, and recent incidents. Ported from the legacy admin
 * overview view (consumes /admin/api/operations/overview).
 */
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
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
import { Spinner } from '@/components/feedback/Spinner'
import { ErrorState } from '@/components/feedback/ErrorState'
import { EmptyState } from '@/components/feedback/EmptyState'
import { adminApi } from '@/api/admin'
import styles from './admin.module.css'

const throughputConfig: ChartConfig = {
  in: { label: 'Messages in', color: 'blue' },
  out: { label: 'Messages out', color: 'purple' },
}

const fmt = (n: number) => Number(n).toLocaleString()

function statusVariant(status: string): 'success' | 'warning' | 'danger' {
  const s = status.toLowerCase()
  if (s.includes('healthy') || s.includes('ok') || s.includes('operational')) return 'success'
  if (s.includes('down') || s.includes('critical') || s.includes('error')) return 'danger'
  return 'warning'
}

function uptime(seconds: number | null): string {
  if (!seconds) return '—'
  const h = Math.floor(seconds / 3600)
  const d = Math.floor(h / 24)
  if (d > 0) return `${d}d ${h % 24}h`
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function humanize(s: string | null | undefined): string {
  if (!s) return 'Event'
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function outcomeVariant(outcome: string): 'success' | 'danger' | 'warning' {
  const o = outcome.toLowerCase()
  if (o === 'success' || o === 'ok' || o === 'recovered') return 'success'
  if (o === 'failure' || o === 'failed' || o === 'error') return 'danger'
  return 'warning'
}

export function Overview() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: () => adminApi.getOverview('24h'),
    refetchInterval: 30_000,
  })

  if (isLoading) return <Centered><Spinner /></Centered>
  if (isError || !data) return <><PageHeader title="Live operations" /><ErrorState message="Failed to load operations overview." onRetry={() => refetch()} /></>

  const throughput = data.throughput.map((p) => {
    // timestamp may be epoch ms (as string) or an ISO string — handle both.
    const epoch = Number(p.timestamp)
    const d = Number.isFinite(epoch) && epoch > 0 ? new Date(epoch) : new Date(p.timestamp)
    return {
      t: isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      in: p.chatIn,
      out: p.chatOut,
    }
  })
  // Only chart when there's something meaningful — avoids the flat-line-plus-spike look.
  const hasThroughput = throughput.length >= 3 && throughput.some((p) => p.in > 0 || p.out > 0)

  return (
    <>
      <PageHeader
        title="Live operations"
        subtitle={`Observed ${new Date(data.observedAt).toLocaleTimeString()}`}
        actions={<Badge variant={statusVariant(data.status)} dot>{data.status}</Badge>}
      />

      <div className={styles.statGrid}>
        <StatCard label="Channels connected" value={fmt(data.channels.connected)} hint={`of ${fmt(data.channels.expected)} expected`} icon="fas fa-tv" />
        <StatCard label="Reconnecting" value={fmt(data.channels.reconnecting)} icon="fas fa-rotate" trend={data.channels.reconnecting > 0 ? 'down' : 'neutral'} />
        <StatCard label="Control API" value={data.bot.controlApiReachable ? 'Reachable' : 'Down'} hint={data.bot.latencyMs != null ? `${data.bot.latencyMs}ms` : ''} icon="fas fa-heart-pulse" />
        <StatCard label="Bot uptime" value={uptime(data.bot.uptimeSeconds)} icon="fas fa-clock" />
        <StatCard label="Commands today" value={fmt(data.commands.today)} hint={`${fmt(data.commands.rangedTotal)} this range`} icon="fas fa-terminal" />
        <StatCard label="Failure rate" value={`${data.commands.failureRate}%`} trend={data.commands.failureRate > 5 ? 'down' : 'up'} icon="fas fa-triangle-exclamation" />
      </div>

      <div className={styles.opGrid}>
        <Card title="Chat throughput" subtitle="Messages in / out (6h)">
          <div style={{ height: 220 }}>
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

        <Card title="Needs attention" subtitle="Recent incidents & recoveries">
          {data.incidents.length === 0 ? (
            <EmptyState icon="fas fa-check" title="All clear" />
          ) : (
            <div className={styles.incidentList}>
              {data.incidents.map((e, i) => (
                <div className={styles.auditItem} key={e.id ?? i} style={{ gridTemplateColumns: '1fr auto' }}>
                  <span>
                    <span className={styles.auditAction}>{humanize(e.type)}</span>
                    {e.channel && <span className={styles.auditMeta}> · {e.channel}</span>}
                    {e.reasonCode && <span className={styles.auditMeta}> · {humanize(e.reasonCode)}</span>}
                  </span>
                  {e.outcome && <Badge variant={outcomeVariant(e.outcome)}>{e.outcome}</Badge>}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Active commands" subtitle="Live command usage" style={{ marginTop: 18 }}>
        {data.commands.activeCommands.length === 0 ? (
          <EmptyState icon="fas fa-terminal" title="No command activity" />
        ) : (
          <div className={styles.chipRow}>
            {data.commands.activeCommands.map((c) => (
              <span className={styles.statChip} key={c.command}>
                <code>!{c.command}</code> {fmt(c.count)}
              </span>
            ))}
          </div>
        )}
      </Card>
    </>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', placeItems: 'center', padding: 60 }}>{children}</div>
}
