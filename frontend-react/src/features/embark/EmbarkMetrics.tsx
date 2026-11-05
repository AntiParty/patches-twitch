import type { EmbarkStats } from '@/api/public'
import { StatCard } from '@/components/cards/StatCard'
import { Card } from '@/components/cards/Card'
import { Spinner } from '@/components/feedback/Spinner'
import { ErrorState } from '@/components/feedback/ErrorState'
import styles from './Embark.module.css'

type EmbarkMetricsStatus = 'pending' | 'success' | 'error'

interface EmbarkMetricsProps {
  status: EmbarkMetricsStatus
  stats: EmbarkStats | undefined
  onRetry?: () => void
}

const metricDefinitions: Array<{ key: keyof EmbarkStats; label: string; icon: string }> = [
  { key: 'streamers', label: 'Streamers', icon: 'fas fa-video' },
  { key: 'commandsProcessed', label: 'Commands processed', icon: 'fas fa-terminal' },
  { key: 'predictionsCreated', label: 'Predictions created', icon: 'fas fa-chart-simple' },
  { key: 'apiRequests', label: 'API requests', icon: 'fas fa-code' },
]

function formatMetric(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

export function EmbarkMetrics({ status, stats, onRetry }: EmbarkMetricsProps) {
  if (status === 'error') {
    return (
      <Card>
        <ErrorState
          title="Couldn’t load platform totals"
          message="Live totals are temporarily unavailable."
          onRetry={onRetry}
        />
      </Card>
    )
  }

  if (status !== 'success' || !stats) {
    return (
      <Card>
        <div className={styles.metricsLoading} role="status" aria-label="Loading live platform totals">
          <Spinner />
        </div>
      </Card>
    )
  }

  return (
    <div className={styles.metrics} aria-label="Lifetime platform totals">
      {metricDefinitions.map(({ key, label, icon }) => (
        <StatCard key={key} label={label} icon={icon} value={formatMetric(stats[key])} hint="Lifetime total" />
      ))}
    </div>
  )
}
