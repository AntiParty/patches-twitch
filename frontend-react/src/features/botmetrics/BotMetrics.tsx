/*
 * Bot metrics (METRICS_PASSWORD-gated). Ported from botmetrics.ejs, with Chart.js
 * replaced by dither-kit. Bot vitals are live from the bot Control API; the old
 * CPU/memory/latency history charts were dropped because nothing records them.
 * On 401 (no metrics session) shows an access panel linking to the backend login.
 */
import { useEffect, useState } from 'react'
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
import { Spinner } from '@/components/feedback/Spinner'
import { ErrorState } from '@/components/feedback/ErrorState'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ApiError } from '@/api/errors'
import { botMetricsApi, BOT_METRICS_LOGIN_URL } from '@/api/botMetrics'
import type { BotLiveStatus, BotMetricsRange, BotMetricsResponse, BotStatus } from '@/types/botMetrics'
import { formatAge, formatAgo, formatBytes, formatCount, formatMs, formatUptime } from './format'
import styles from './BotMetrics.module.css'

const REFRESH_MS = 30_000

const RANGES: { value: BotMetricsRange; label: string }[] = [
  { value: '30m', label: '30m' },
  { value: '1h', label: '1h' },
  { value: '3h', label: '3h' },
  { value: '6h', label: '6h' },
]

const STATUS: Record<BotStatus, { label: string; variant: 'success' | 'warning' | 'danger' }> = {
  operational: { label: 'Operational', variant: 'success' },
  degraded: { label: 'Degraded', variant: 'warning' },
  outage: { label: 'Bot unreachable', variant: 'danger' },
}

const commandsConfig: ChartConfig = {
  count: { label: 'Commands', color: 'purple' },
}

const chatConfig: ChartConfig = {
  in: { label: 'Messages in', color: 'blue' },
  out: { label: 'Bot messages out', color: 'purple' },
}

export function BotMetrics() {
  const [range, setRange] = useState<BotMetricsRange>('1h')
  const { data, error, isLoading, refetch, dataUpdatedAt, isFetching } = useQuery({
    queryKey: ['botmetrics', range],
    queryFn: () => botMetricsApi.get(range),
    refetchInterval: REFRESH_MS,
    placeholderData: keepPreviousData,
    retry: false,
  })

  // Re-render every second so "Updated 12s ago" stays current.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  if (error instanceof ApiError && error.isUnauthorized) {
    return (
      <div className={styles.page}>
        <div className={styles.access}>
          <i className={`fas fa-lock ${styles.accessIcon}`} />
          <h2 className={styles.accessTitle}>Metrics password required</h2>
          <p className={styles.accessText}>Sign in with the metrics password to view live bot metrics.</p>
          <a className="btn btn-primary" href={BOT_METRICS_LOGIN_URL}>
            Sign in to bot metrics
          </a>
        </div>
      </div>
    )
  }

  const rangePicker = (
    <div className={styles.range} role="group" aria-label="Graph range">
      {RANGES.map((r) => (
        <button
          key={r.value}
          type="button"
          className={styles.rangeBtn}
          aria-pressed={range === r.value}
          onClick={() => setRange(r.value)}
        >
          {r.label}
        </button>
      ))}
    </div>
  )

  return (
    <div className={styles.page}>
      <PageHeader
        title="Bot metrics"
        subtitle={
          data
            ? `Updated ${formatAgo(now - dataUpdatedAt)} · refreshes every 30s${isFetching ? ' · refreshing…' : ''}`
            : 'Live bot status, commands and chat traffic'
        }
        actions={rangePicker}
      />

      {isLoading ? (
        <div className={styles.loading}><Spinner /></div>
      ) : !data ? (
        <ErrorState message="Failed to load bot metrics." onRetry={() => refetch()} />
      ) : (
        <>
          <BotStatusPanel bot={data.bot} />
          <TodayStats data={data} />
          <Graphs data={data} />
          <TopTables data={data} />
        </>
      )}
    </div>
  )
}

function BotStatusPanel({ bot }: { bot: BotLiveStatus }) {
  const status = STATUS[bot.status]
  const channels =
    bot.connectedChannels == null
      ? '—'
      : `${formatCount(bot.connectedChannels)} connected${bot.reconnectingChannels ? ` · ${bot.reconnectingChannels} reconnecting` : ''}`
  const eventSub = bot.eventSubConnected == null ? '—' : bot.eventSubConnected ? 'Connected' : 'Not connected'

  const vitals: { label: string; value: string; tone?: 'warn' }[] = [
    { label: 'Uptime', value: formatUptime(bot.uptimeSeconds) },
    { label: 'Memory (RSS)', value: formatBytes(bot.rssBytes) },
    { label: 'Heap used', value: formatBytes(bot.heapUsedBytes) },
    { label: 'IRC channels', value: channels, tone: bot.reconnectingChannels ? 'warn' : undefined },
    { label: 'EventSub', value: eventSub, tone: bot.eventSubConnected === false ? 'warn' : undefined },
    { label: 'Database', value: formatMs(bot.databaseLatencyMs) },
    { label: 'Leaderboard cache', value: formatAge(bot.cacheAgeSeconds) },
  ]

  return (
    <section className={styles.statusPanel} aria-label="Bot status">
      <div className={styles.statusHead}>
        <Badge variant={status.variant} dot>{status.label}</Badge>
        <span className={styles.statusNote}>
          {bot.controlApiReachable
            ? `Control API answered in ${formatMs(bot.controlApiLatencyMs)}`
            : 'The bot process did not answer its Control API.'}
        </span>
      </div>
      <dl className={styles.vitals}>
        {vitals.map((v) => (
          <div key={v.label} className={styles.vital}>
            <dt>{v.label}</dt>
            <dd className={v.tone === 'warn' ? styles.warn : undefined}>{v.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function TodayStats({ data }: { data: BotMetricsResponse }) {
  const hasCommands = data.commandsToday > 0
  return (
    <div className={styles.statGrid}>
      <StatCard label="Channels" value={formatCount(data.channels)} hint="bot enabled" />
      <StatCard label="Live now" value={formatCount(data.liveChannels)} hint={`${formatCount(data.activeSessions)} tracked sessions`} />
      <StatCard label="Commands today" value={formatCount(data.commandsToday)} hint="since midnight" />
      <StatCard
        label="Success rate today"
        value={hasCommands ? `${data.successRate}%` : '—'}
        hint={hasCommands ? `${formatCount(data.commandsFailedToday)} failed` : 'no commands yet'}
        trend={data.successRate < 95 ? 'down' : 'neutral'}
      />
      <StatCard label="Users seen" value={formatCount(data.usersSeen)} hint="all time" />
    </div>
  )
}

function Graphs({ data }: { data: BotMetricsResponse }) {
  const hasCommands = data.minuteGraph.some((p) => p.count > 0)
  const hasChat = data.chatGraph.length > 0
  const per = `per ${data.bucketLabel}`

  return (
    <div className={styles.chartGrid}>
      <Card title="Commands" subtitle={per}>
        <div className={styles.chartBox}>
          {hasCommands ? (
            <AreaChart data={data.minuteGraph} config={commandsConfig} bloom="low">
              <Grid />
              <XAxis dataKey="minute" maxTicks={6} />
              <YAxis />
              <Tooltip labelKey="minute" />
              <Area dataKey="count" />
            </AreaChart>
          ) : (
            <EmptyState icon="fas fa-terminal" title="No commands in this window" />
          )}
        </div>
      </Card>
      <Card title="Chat messages" subtitle={per}>
        <div className={styles.chartBox}>
          {hasChat ? (
            <AreaChart data={data.chatGraph} config={chatConfig} bloom="low">
              <Grid />
              <XAxis dataKey="minute" maxTicks={6} />
              <YAxis />
              <Legend isClickable />
              <Tooltip labelKey="minute" />
              <Area dataKey="in" />
              <Area dataKey="out" />
            </AreaChart>
          ) : (
            <EmptyState
              icon="fas fa-comments"
              title="No chat data"
              description="Chat rates are kept in the bot process's memory, so they're missing while the bot is unreachable or just restarted."
            />
          )}
        </div>
      </Card>
    </div>
  )
}

function TopTables({ data }: { data: BotMetricsResponse }) {
  return (
    <div className={styles.tableGrid}>
      <RankTable
        title="Top channels today"
        rows={data.topChannels.map((r) => ({ name: r.channel, count: Number(r.count) }))}
        empty="No commands today."
      />
      <RankTable
        title="Top commands today"
        rows={data.topCommands.map((r) => ({ name: r.command, count: Number(r.count) }))}
        empty="No commands today."
        mono
      />
    </div>
  )
}

function RankTable({
  title,
  rows,
  empty,
  mono = false,
}: {
  title: string
  rows: { name: string; count: number }[]
  empty: string
  mono?: boolean
}) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <p className={styles.tableEmpty}>{empty}</p>
      ) : (
        <ol className={styles.rankList}>
          {rows.map((r) => (
            <li key={r.name} className={styles.rankRow}>
              <span className={mono ? `${styles.rankName} ${styles.mono}` : styles.rankName}>{r.name}</span>
              <span className={styles.rankCount}>{formatCount(r.count)}</span>
              <span className={styles.rankBar} aria-hidden>
                <span style={{ width: `${(r.count / max) * 100}%` }} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}
