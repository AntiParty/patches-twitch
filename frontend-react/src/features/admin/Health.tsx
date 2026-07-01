/*
 * Admin → Bot Health. Process/connection/resource history charts.
 * Ported from the legacy admin health view (consumes /admin/api/operations/health).
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/cards/Card'
import { Select } from '@/components/forms/Select'
import { Spinner } from '@/components/feedback/Spinner'
import { ErrorState } from '@/components/feedback/ErrorState'
import { EmptyState } from '@/components/feedback/EmptyState'
import { adminApi } from '@/api/admin'
import type { PerformancePoint } from '@/types/admin'
import styles from './admin.module.css'

const tooltipStyle = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 }
const RANGES = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
]

const CHARTS: { key: keyof PerformancePoint; label: string; color: string; transform?: (n: number) => number }[] = [
  { key: 'cpuUsage', label: 'CPU usage (%)', color: 'var(--primary)' },
  { key: 'memoryUsed', label: 'Memory used (MB)', color: 'var(--info)', transform: (n) => Math.round(n / 1024 / 1024) },
  { key: 'botLatencyMs', label: 'Bot latency (ms)', color: 'var(--warning)' },
  { key: 'connectedChannels', label: 'Connected channels', color: 'var(--success)' },
]

export function Health() {
  const [range, setRange] = useState('24h')
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'health', range],
    queryFn: () => adminApi.getHealth(range),
  })

  return (
    <>
      <PageHeader
        title="Bot Health"
        subtitle="Read-only process, connection, and resource history."
        actions={
          <div style={{ width: 160 }}>
            <Select value={range} onChange={(e) => setRange(e.target.value)} options={RANGES} />
          </div>
        }
      />

      {isLoading ? (
        <div style={{ display: 'grid', placeItems: 'center', padding: 60 }}><Spinner /></div>
      ) : isError || !data ? (
        <ErrorState message="Failed to load bot health." onRetry={() => refetch()} />
      ) : data.performanceHistory.length === 0 ? (
        <EmptyState icon="fas fa-heart-pulse" title="No performance history for this range" />
      ) : (
        <div className={styles.chartGrid}>
          {CHARTS.map((c) => {
            const series = data.performanceHistory.map((p) => ({
              t: new Date(p.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              v: p[c.key] == null ? null : c.transform ? c.transform(Number(p[c.key])) : Number(p[c.key]),
            }))
            return (
              <Card key={String(c.key)} title={c.label}>
                <div style={{ height: 200 }}>
                  <ResponsiveContainer>
                    <LineChart data={series}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="t" tick={{ fontSize: 11, fill: 'var(--text-subtle)' }} minTickGap={40} />
                      <YAxis tick={{ fontSize: 11, fill: 'var(--text-subtle)' }} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Line type="monotone" dataKey="v" stroke={c.color} strokeWidth={2} dot={false} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </>
  )
}
