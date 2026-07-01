/* Horizontal progress bar with optional label + value readout. */
import styles from './ProgressBar.module.css'

interface ProgressBarProps {
  value: number
  max?: number
  label?: string
  /** Show "value / max" on the right of the label row. */
  showValue?: boolean
  color?: string
}

export function ProgressBar({ value, max = 100, label, showValue, color }: ProgressBarProps) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100))
  return (
    <div className={styles.wrap}>
      {(label || showValue) && (
        <div className={styles.head}>
          {label && <span className={styles.label}>{label}</span>}
          {showValue && (
            <span className={styles.value}>
              {value} / {max}
            </span>
          )}
        </div>
      )}
      <div
        className={styles.track}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        <div className={styles.fill} style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}
