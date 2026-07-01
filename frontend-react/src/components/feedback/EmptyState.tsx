/* Centered empty-state message with optional icon + action. */
import type { ReactNode } from 'react'
import styles from './State.module.css'

interface EmptyStateProps {
  icon?: string
  title: string
  description?: ReactNode
  action?: ReactNode
}

export function EmptyState({ icon = 'fas fa-inbox', title, description, action }: EmptyStateProps) {
  return (
    <div className={styles.state}>
      <i className={`${styles.icon} ${icon}`} />
      <h3 className={styles.title}>{title}</h3>
      {description && <p className={styles.description}>{description}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  )
}
