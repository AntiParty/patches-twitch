import type { EmbarkStats } from '@/api/public'
import { Spinner } from '@/components/feedback/Spinner'
import { ErrorState } from '@/components/feedback/ErrorState'
import styles from './Embark.module.css'

type EmbarkMetricsStatus = 'pending' | 'success' | 'error'

interface EmbarkMetricsProps {
  status: EmbarkMetricsStatus
  stats: EmbarkStats | undefined
  onRetry?: () => void
}

const metricDefinitions: Array<{ key: keyof EmbarkStats; label: string; desc: string }> = [
  { key: 'streamers', label: 'Streamers', desc: 'Twitch channels registered with FinalsRS.' },
  { key: 'commandsProcessed', label: 'Commands processed', desc: 'Chat commands the bot has run, counted once per use.' },
  { key: 'predictionsCreated', label: 'Predictions created', desc: 'Twitch predictions opened by automatic ranked runs.' },
  { key: 'apiRequests', label: 'API requests', desc: 'Requests to the public developer API.' },
]

function formatMetric(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

export function EmbarkMetrics({ status, stats, onRetry }: EmbarkMetricsProps) {
  if (status === 'error') {
    return (
      <div className={styles.metricsState}>
        <ErrorState
          title="Couldn’t load platform totals"
          message="Live totals are temporarily unavailable."
          onRetry={onRetry}
        />
      </div>
    )
  }

  if (status !== 'success' || !stats) {
    return (
      <div className={styles.metricsState} role="status" aria-label="Loading live platform totals">
        <Spinner />
      </div>
    )
  }

  return (
    <div className={styles.metricsBand}>
      <div className={styles.metrics} aria-label="Lifetime platform totals">
        {metricDefinitions.map(({ key, label, desc }) => (
          <div className={styles.metric} key={key}>
            <span className={styles.metricValue}>{formatMetric(stats[key])}</span>
            <span className={styles.metricLabel}>{label}</span>
            <span className={styles.metricDesc}>{desc}</span>
          </div>
        ))}
      </div>
      <p className={styles.metricsNote}>Lifetime platform totals, live from FinalsRS</p>
    </div>
  )
}
