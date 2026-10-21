/*
 * Admin → Bot Health. Process/connection/resource history charts.
 * Ported from the legacy admin health view (consumes /admin/api/operations/health).
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LineChart } from '@/components/dither-kit/area-chart'
import { Line } from '@/components/dither-kit/area'
import { Grid } from '@/components/dither-kit/grid'
import { XAxis } from '@/components/dither-kit/x-axis'
import { YAxis } from '@/components/dither-kit/y-axis'
import { Tooltip } from '@/components/dither-kit/tooltip'
import type { DitherColor } from '@/components/dither-kit/palette'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/cards/Card'
import { Select } from '@/components/forms/Select'
import { Spinner } from '@/components/feedback/Spinner'
import { ErrorState } from '@/components/feedback/ErrorState'
import { EmptyState } from '@/components/feedback/EmptyState'
import { adminApi } from '@/api/admin'
import type { PerformancePoint } from '@/types/admin'
import styles from './admin.module.css'

const RANGES = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
]

// Bot process samples (one per minute), averaged per bucket by the backend.
const CHARTS: { key: keyof PerformancePoint; label: string; color: DitherColor; transform?: (n: number) => number }[] = [
  { key: 'cpuUsage', label: 'CPU (% of one core)', color: 'purple' },
  { key: 'memoryUsed', label: 'Memory, RSS (MB)', color: 'blue', transform: (n) => Math.round(n / 1024 / 1024) },
  { key: 'botLatencyMs', label: 'Event-loop delay (ms)', color: 'orange' },
  { key: 'connectedChannels', label: 'Connected IRC channels', color: 'green' },
]

// Axis: clock time for 24h, the day for longer ranges. Tooltip: full date + time.
function axisLabel(timestamp: string, range: string): string {
  const d = new Date(timestamp)
  return range === '24h'
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function tooltipLabel(timestamp: string): string {
  return new Date(timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

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
        subtitle="Bot process resources and IRC connections, sampled every minute."
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
            // Dither-kit has no connectNulls — drop gap points instead.
            const series = data.performanceHistory.flatMap((p) => {
              if (p[c.key] == null) return []
              return [{
                t: axisLabel(p.timestamp, range),
                at: tooltipLabel(p.timestamp),
                v: c.transform ? c.transform(Number(p[c.key])) : Number(p[c.key]),
              }]
            })
            return (
              <Card key={String(c.key)} title={c.label}>
                <div style={{ height: 200 }}>
                  {series.length === 0 ? (
                    <EmptyState icon="fas fa-heart-pulse" title="No data for this metric" />
                  ) : (
                    <LineChart data={series} config={{ v: { label: c.label, color: c.color } }} bloom="low">
                      <Grid />
                      <XAxis dataKey="t" maxTicks={5} />
                      <YAxis />
                      <Tooltip labelKey="at" />
                      <Line dataKey="v" />
                    </LineChart>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </>
  )
}
