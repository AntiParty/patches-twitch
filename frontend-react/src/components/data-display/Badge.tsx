/* Pill badge with status variants. Builds on the design-system badge shape. */
import type { ReactNode } from 'react'
import styles from './Badge.module.css'

type Variant = 'default' | 'primary' | 'success' | 'danger' | 'warning' | 'info'

interface BadgeProps {
  variant?: Variant
  /** Show the leading status dot. */
  dot?: boolean
  icon?: string
  children: ReactNode
}

export function Badge({ variant = 'default', dot = false, icon, children }: BadgeProps) {
  return (
    <span className={`${styles.badge} ${styles[variant]}`}>
      {dot && <span className={styles.dot} />}
      {icon && <i className={icon} />}
      {children}
    </span>
  )
}
