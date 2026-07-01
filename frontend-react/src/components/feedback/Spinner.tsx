/* Indeterminate loading spinner. */
import styles from './Spinner.module.css'

interface SpinnerProps {
  /** Diameter in px. */
  size?: number
  /** Stroke color (defaults to currentColor). */
  color?: string
  label?: string
}

export function Spinner({ size = 24, color = 'currentColor', label = 'Loading' }: SpinnerProps) {
  return (
    <span
      className={styles.spinner}
      role="status"
      aria-label={label}
      style={{ width: size, height: size, borderColor: color, borderTopColor: 'transparent' }}
    />
  )
}
