/*
 * Generic vertical sidebar used by the dashboard and admin layouts.
 * Driven by an item config so it stays reusable. Items can be:
 *  - internal route links (NavLink, auto active state)
 *  - external links (open in a new tab)
 *  - actions (onClick)
 * Markup/classes mirror the legacy dashboard sidebar.
 */
import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import styles from './Sidebar.module.css'

export interface SidebarItem {
  label: string
  /** Font Awesome class, e.g. "fas fa-home". */
  icon: string
  /** Internal route (NavLink). */
  to?: string
  /** External URL (new tab). */
  href?: string
  /** Action handler. */
  onClick?: () => void
  /** Render with a warning accent + top divider (e.g. Admin link). */
  variant?: 'default' | 'accent'
  /** Only match the route exactly (for index routes like the overview). */
  end?: boolean
}

interface SidebarProps {
  items: SidebarItem[]
  logo?: ReactNode
  footer?: ReactNode
}

export function Sidebar({ items, logo, footer }: SidebarProps) {
  return (
    <aside className={styles.sidebar}>
      {logo}

      <ul className={styles.navMenu}>
        {items.map((item) => (
          <li key={item.label}>{renderItem(item)}</li>
        ))}
      </ul>

      {footer && <div className={styles.footer}>{footer}</div>}
    </aside>
  )
}

function renderItem(item: SidebarItem) {
  const className = item.variant === 'accent' ? `${styles.navItem} ${styles.accent}` : styles.navItem
  const inner = (
    <>
      <i className={item.icon} />
      <span>{item.label}</span>
    </>
  )

  if (item.to) {
    return (
      <NavLink
        to={item.to}
        end={item.end}
        className={({ isActive }) => (isActive ? `${className} ${styles.active}` : className)}
      >
        {inner}
      </NavLink>
    )
  }
  if (item.href) {
    return (
      <a className={className} href={item.href} target="_blank" rel="noreferrer">
        {inner}
      </a>
    )
  }
  return (
    <button type="button" className={className} onClick={item.onClick}>
      {inner}
    </button>
  )
}
