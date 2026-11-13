/* Compact metric card: label, big value, optional icon + delta trend. */
import { Link } from 'react-router-dom'
import styles from './StatCard.module.css'

interface StatCardProps {
  label: string
  value: string | number
  icon?: string
  /** Signed change, e.g. "+120" or "-3.2%". Colored by sign. */
  delta?: string
  trend?: 'up' | 'down' | 'neutral'
  hint?: string
  /** Internal route; renders the whole card as a link. */
  to?: string
  /** Colours the value to flag a problem; unset keeps the default. */
  tone?: 'warning' | 'danger'
}

export function StatCard({ label, value, icon, delta, trend, hint, to, tone }: StatCardProps) {
  const trendClass =
    trend === 'up' ? styles.up : trend === 'down' ? styles.down : styles.neutral

  const className = to ? `${styles.stat} ${styles.link}` : styles.stat
  const body = (
    <>
      <div className={styles.top}>
        <span className={styles.label}>{label}</span>
        {icon && <i className={`${styles.icon} ${icon}`} />}
      </div>
      <div className={`${styles.value} ${tone === 'danger' ? styles.toneDanger : tone === 'warning' ? styles.toneWarning : ''}`}>{value}</div>
      {(delta || hint) && (
        <div className={styles.footer}>
          {delta && <span className={`${styles.delta} ${trendClass}`}>{delta}</span>}
          {hint && <span className={styles.hint}>{hint}</span>}
        </div>
      )}
    </>
  )

  return to ? (
    <Link to={to} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}
