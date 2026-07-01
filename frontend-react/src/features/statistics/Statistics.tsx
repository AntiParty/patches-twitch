/*
 * Statistics dashboard (analyst-gated). Ported from statistics-dashboard.ejs,
 * with Chart.js replaced by Recharts. Tabs: Overview / Web / Commands / System.
 * On 403 (no analyst session) shows an access panel linking to the backend login.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatCard } from '@/components/cards/StatCard'
import { Tabs } from '@/components/data-display/Tabs'
import { Spinner } from '@/components/feedback/Spinner'
import { ApiError } from '@/api/errors'
import { statisticsApi, STATISTICS_LOGIN_URL } from '@/api/statistics'
import type { StatisticsResponse } from '@/types/statistics'
import styles from './Statistics.module.css'

const fmt = (n = 0) => Number(n).toLocaleString()
const fmtMs = (ms = 0) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`)

const AXIS = { stroke: 'var(--text-subtle)', fontSize: 12 }
const GRID = 'rgba(255,255,255,0.06)'
const PIE_COLORS = ['#42d483', '#7ab8ff', '#f3c247', '#e62038', '#a37bff', '#ff9f43']

const TABS = [
  { id: 'overview', label: 'Overview', icon: 'fas fa-gauge-high' },
  { id: 'web', label: 'Web Requests', icon: 'fas fa-globe' },
  { id: 'commands', label: 'Commands', icon: 'fas fa-terminal' },
  { id: 'system', label: 'System', icon: 'fas fa-server' },
]

export function Statistics() {
  const [tab, setTab] = useState('overview')
  const { data, isLoading, error } = useQuery({
    queryKey: ['statistics'],
    queryFn: statisticsApi.get,
    retry: false,
  })

  if (isLoading) {
    return (
      <div className={styles.page}>
        <PageHeader title="Statistics" />
        <div style={{ display: 'grid', placeItems: 'center', padding: 80 }}>
          <Spinner />
        </div>
      </div>
    )
  }

  if (error instanceof ApiError && error.isForbidden) {
    return (
      <div className={styles.page}>
        <div className={styles.access}>
          <i className={`fas fa-lock ${styles.accessIcon}`} />
          <h2 style={{ margin: '0 0 8px' }}>Analyst access required</h2>
          <p style={{ color: 'var(--text-muted)', margin: '0 0 20px' }}>
            Sign in with an analyst account to view site statistics.
          </p>
          <a className="btn btn-primary" href={STATISTICS_LOGIN_URL}>
            Log in to Statistics
          </a>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className={styles.page}>
        <PageHeader title="Statistics" />
        <p style={{ color: 'var(--danger)' }}>Failed to load statistics.</p>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Statistics"
        subtitle={`Last updated ${new Date(data.timestamp).toLocaleString()}`}
      />
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'overview' && <OverviewTab data={data} />}
      {tab === 'web' && <WebTab data={data} />}
      {tab === 'commands' && <CommandsTab data={data} />}
      {tab === 'system' && <SystemTab data={data} />}
    </div>
  )
}

function OverviewTab({ data }: { data: StatisticsResponse }) {
  const hourly = useMemo(
    () => data.requestMetrics.hourlyDistribution.map((h) => ({ hour: `${h.hour}:00`, count: h.count })),
    [data],
  )
  const status = useMemo(
    () => data.requestMetrics.byStatus.map((s) => ({ name: String(s.statusCode), value: s.count })),
    [data],
  )
  return (
    <>
      <div className={styles.statGrid}>
        <StatCard label="Total Requests" value={fmt(data.webAnalytics.totalRequests)} icon="fas fa-globe" />
        <StatCard label="Total Commands" value={fmt(data.commandAnalytics.totalCommands)} icon="fas fa-terminal" />
        <StatCard label="IGN Visits (7d)" value={fmt(data.ignStats.last7days)} icon="fas fa-id-badge" />
        <StatCard label="Avg Response" value={fmtMs(data.webAnalytics.avgResponseTime)} icon="fas fa-stopwatch" />
      </div>
      <div className={styles.chartGrid}>
        <div className={styles.chartCard}>
          <div className={styles.chartTitle}>Requests by hour (24h)</div>
          <div className={styles.chartBox}>
            <ResponsiveContainer>
              <BarChart data={hourly}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="hour" {...AXIS} />
                <YAxis {...AXIS} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className={styles.chartCard}>
          <div className={styles.chartTitle}>Status codes</div>
          <div className={styles.chartBox}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={status} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {status.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </>
  )
}

function WebTab({ data }: { data: StatisticsResponse }) {
  const statuses = data.requestMetrics.byStatus
  const total = statuses.reduce((s, x) => s + (x.count || 0), 0)
  const success = statuses.filter((s) => s.statusCode >= 200 && s.statusCode < 300).reduce((s, x) => s + x.count, 0)
  const successRate = total > 0 ? ((success / total) * 100).toFixed(1) : '0'
  return (
    <>
      <div className={styles.statGrid}>
        <StatCard label="Total Requests" value={fmt(data.webAnalytics.totalRequests)} />
        <StatCard label="Unique Visitors" value={fmt(data.webAnalytics.uniqueVisitors)} />
        <StatCard label="Avg Response" value={fmtMs(data.webAnalytics.avgResponseTime)} />
        <StatCard label="Success Rate" value={`${successRate}%`} />
      </div>
      <div className={styles.chartCard}>
        <div className={styles.chartTitle}>Top endpoints (30d)</div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Endpoint</th>
              <th className={styles.num}>Requests</th>
              <th className={styles.num}>Avg Response</th>
            </tr>
          </thead>
          <tbody>
            {data.requestMetrics.byEndpoint.map((e) => (
              <tr key={e.endpoint}>
                <td><code>{e.endpoint}</code></td>
                <td className={styles.num} style={{ color: 'var(--primary)', fontWeight: 600 }}>{fmt(e.count)}</td>
                <td className={styles.num} style={{ color: 'var(--text-muted)' }}>{fmtMs(e.avgResponseTime)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function CommandsTab({ data }: { data: StatisticsResponse }) {
  const a = data.commandAnalytics
  const daily = (a.dailyUsage ?? []).map((d) => ({ date: d.date, count: d.count }))
  return (
    <>
      <div className={styles.statGrid}>
        <StatCard label="Total Commands" value={fmt(a.totalCommands)} />
        <StatCard label="Unique Commands" value={fmt(a.uniqueCommands)} />
        <StatCard label="Most Popular" value={a.topCommands?.[0]?.command ?? '—'} />
        <StatCard label="Active Channels" value={fmt(a.activeChannels)} />
      </div>
      {daily.length > 0 && (
        <div className={styles.chartCard} style={{ marginBottom: 18 }}>
          <div className={styles.chartTitle}>Daily command usage</div>
          <div className={styles.chartBox}>
            <ResponsiveContainer>
              <LineChart data={daily}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="date" {...AXIS} />
                <YAxis {...AXIS} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="count" stroke="var(--primary)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <div className={styles.chartCard}>
        <div className={styles.chartTitle}>Top commands</div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Command</th>
              <th className={styles.num}>Uses</th>
              <th className={styles.num}>Channels</th>
            </tr>
          </thead>
          <tbody>
            {(a.topCommands ?? []).map((c) => (
              <tr key={c.command}>
                <td><code style={{ color: 'var(--primary)' }}>!{c.command}</code></td>
                <td className={styles.num} style={{ fontWeight: 600 }}>{fmt(c.count)}</td>
                <td className={styles.num} style={{ color: 'var(--text-muted)' }}>{fmt(c.channels ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function SystemTab({ data }: { data: StatisticsResponse }) {
  const perf = data.performanceHistory.map((p) => ({
    t: new Date(p.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    cpu: p.cpuUsage,
    mem: p.memoryUsed,
    latency: p.botLatencyMs,
    channels: p.connectedChannels,
  }))
  const referrals = data.referrals.map((r) => ({ source: r.source, count: r.count })).slice(0, 12)

  const line = (key: string, label: string, color: string) => (
    <div className={styles.chartCard}>
      <div className={styles.chartTitle}>{label}</div>
      <div className={styles.chartBox} style={{ height: 220 }}>
        <ResponsiveContainer>
          <LineChart data={perf}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="t" {...AXIS} minTickGap={40} />
            <YAxis {...AXIS} />
            <Tooltip contentStyle={tooltipStyle} />
            <Line type="monotone" dataKey={key} stroke={color} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )

  return (
    <>
      <div className={styles.chartGrid}>
        {line('cpu', 'CPU usage (%)', '#e62038')}
        {line('mem', 'Memory used (MB)', '#7ab8ff')}
      </div>
      <div className={styles.chartGrid}>
        {line('latency', 'Bot latency (ms)', '#f3c247')}
        {line('channels', 'Connected channels', '#42d483')}
      </div>
      <div className={styles.chartCard}>
        <div className={styles.chartTitle}>Top referral sources (30d)</div>
        <div className={styles.chartBox}>
          <ResponsiveContainer>
            <BarChart data={referrals} layout="vertical" margin={{ left: 40 }}>
              <CartesianGrid stroke={GRID} horizontal={false} />
              <XAxis type="number" {...AXIS} />
              <YAxis type="category" dataKey="source" {...AXIS} width={120} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="count" fill="var(--primary)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  )
}

const tooltipStyle = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text-main)',
  fontSize: 13,
}
