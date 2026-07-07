/*
 * Authenticated dashboard shell: scoped red theme + fixed sidebar + scrollable
 * routed content. Sidebar items map to nested dashboard routes (Phase 4).
 * Layout/structure mirror the legacy user-dashboard.ejs.
 */
import { useMemo } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar, type SidebarItem } from '@/components/navigation/Sidebar'
import { Logo } from '@/components/layout/Logo'
import { UserProfile } from '@/components/layout/UserAvatar'
import { useAuth } from '@/hooks/useAuth'
import styles from './DashboardLayout.module.css'

export function DashboardLayout() {
  const { user, role } = useAuth()

  const items = useMemo<SidebarItem[]>(() => {
    const base: SidebarItem[] = [
      { label: 'Overview', icon: 'fas fa-home', to: '/dashboard', end: true },
      { label: 'My Commands', icon: 'fas fa-terminal', to: '/dashboard/commands' },
      { label: 'Predictions', icon: 'fas fa-square-poll-horizontal', to: '/dashboard/predictions' },
      { label: 'Giveaways', icon: 'fas fa-gift', to: '/dashboard/giveaways' },
      { label: 'Rank Tracker', icon: 'fas fa-chart-line', to: '/dashboard/rank-tracker' },
      { label: 'Stream Overlays', icon: 'fas fa-tv', to: '/dashboard/overlays' },
      { label: 'Settings', icon: 'fas fa-cog', to: '/dashboard/settings' },
      { label: 'Documentation', icon: 'fas fa-book', href: '/docs' },
    ]
    if (role === 'admin' || role === 'Staff') {
      base.push({
        label: 'Admin Dashboard',
        icon: 'fas fa-user-shield',
        href: '/admin',
        variant: 'accent',
      })
    }
    base.push({ label: 'Custom Bot', icon: 'fas fa-robot', to: '/dashboard/subscription' })
    return base
  }, [role])

  return (
    <div className={styles.container}>
      <Sidebar
        items={items}
        logo={<Logo />}
        footer={user && <UserProfile name={user.username} role={user.role} />}
      />
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}
