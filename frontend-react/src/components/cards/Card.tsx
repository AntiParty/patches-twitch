/*
 * Card container with an optional header (title + subtitle + actions).
 * Mirrors the legacy dashboard `.card` / `.card-header` / `.card-title`.
 * Uses CSS variables so it adapts to whichever theme scope it renders in.
 */
import type { HTMLAttributes, ReactNode } from 'react'
import styles from './Card.module.css'

interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode
  subtitle?: ReactNode
  /** Right-aligned header content (e.g. a timestamp or button). */
  headerActions?: ReactNode
  children?: ReactNode
}

export function Card({
  title,
  subtitle,
  headerActions,
  children,
  className = '',
  ...rest
}: CardProps) {
  const hasHeader = title || subtitle || headerActions
  return (
    <div className={`${styles.card} ${className}`} {...rest}>
      {hasHeader && (
        <div className={styles.header}>
          <div>
            {title && <h2 className={styles.title}>{title}</h2>}
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
          {headerActions && <div className={styles.actions}>{headerActions}</div>}
        </div>
      )}
      {children}
    </div>
  )
}
