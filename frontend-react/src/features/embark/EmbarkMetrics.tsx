import type { EmbarkStats } from '@/api/public'
import styles from './Embark.module.css'

type EmbarkMetricsStatus = 'pending' | 'success' | 'error'

interface EmbarkMetricsProps {
  status: EmbarkMetricsStatus
  stats: EmbarkStats | undefined
}

const metricDefinitions: Array<{ key: keyof EmbarkStats; label: string }> = [
  { key: 'streamers', label: 'Streamers' },
  { key: 'commandsProcessed', label: 'Commands processed' },
  { key: 'predictionsCreated', label: 'Predictions created' },
  { key: 'apiRequests', label: 'API requests' },
]

function formatMetric(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

export function EmbarkMetrics({ status, stats }: EmbarkMetricsProps) {
  if (status !== 'success' || !stats) {
    return (
      <p className={styles.metricStatus} aria-live="polite" role="status">
        {status === 'error'
          ? 'Live totals are temporarily unavailable.'
          : 'Loading live platform totals…'}
      </p>
    )
  }

  return (
    <div className={styles.metrics} aria-label="Lifetime platform totals">
      {metricDefinitions.map(({ key, label }) => (
        <div className={styles.metric} key={key}>
          <strong>{formatMetric(stats[key])}</strong>
          <span>{label}</span>
        </div>
      ))}
    </div>
  )
}
