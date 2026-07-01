/* Compact metric card: label, big value, optional icon + delta trend. */
import styles from './StatCard.module.css'

interface StatCardProps {
  label: string
  value: string | number
  icon?: string
  /** Signed change, e.g. "+120" or "-3.2%". Colored by sign. */
  delta?: string
  trend?: 'up' | 'down' | 'neutral'
  hint?: string
}

export function StatCard({ label, value, icon, delta, trend, hint }: StatCardProps) {
  const trendClass =
    trend === 'up' ? styles.up : trend === 'down' ? styles.down : styles.neutral

  return (
    <div className={styles.stat}>
      <div className={styles.top}>
        <span className={styles.label}>{label}</span>
        {icon && <i className={`${styles.icon} ${icon}`} />}
      </div>
      <div className={styles.value}>{value}</div>
      {(delta || hint) && (
        <div className={styles.footer}>
          {delta && <span className={`${styles.delta} ${trendClass}`}>{delta}</span>}
          {hint && <span className={styles.hint}>{hint}</span>}
        </div>
      )}
    </div>
  )
}
