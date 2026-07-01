/*
 * Inline notification banner (info/success/warning/danger).
 * Used e.g. for the "Twitch connection needs renewal" notice on the dashboard.
 */
import type { ReactNode } from 'react'
import styles from './NotificationBanner.module.css'

type Variant = 'info' | 'success' | 'warning' | 'danger'

const ICONS: Record<Variant, string> = {
  info: 'fas fa-circle-info',
  success: 'fas fa-circle-check',
  warning: 'fas fa-triangle-exclamation',
  danger: 'fas fa-triangle-exclamation',
}

interface NotificationBannerProps {
  variant?: Variant
  title?: string
  children: ReactNode
  /** Optional call-to-action. */
  action?: { label: string; href: string }
  icon?: string
}

export function NotificationBanner({
  variant = 'info',
  title,
  children,
  action,
  icon,
}: NotificationBannerProps) {
  return (
    <div className={`${styles.banner} ${styles[variant]}`} role="status">
      <i className={`${styles.icon} ${icon ?? ICONS[variant]}`} />
      <div className={styles.body}>
        {title && <strong className={styles.title}>{title}</strong>}
        <span>{children}</span>
      </div>
      {action && (
        <a className={styles.action} href={action.href}>
          {action.label}
        </a>
      )}
    </div>
  )
}
