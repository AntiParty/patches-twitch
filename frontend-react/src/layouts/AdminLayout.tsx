/*
 * Admin shell. Same scoped dark theme + sidebar pattern as the dashboard, but
 * with admin nav items. Route-level access is enforced by ProtectedRoute
 * (requireAdmin) in the router; the backend remains the real authority.
 * Admin views are migrated in Phase 9.
 */
import { Outlet } from 'react-router-dom'
import { Sidebar, type SidebarItem } from '@/components/navigation/Sidebar'
import { Logo } from '@/components/layout/Logo'
import { UserProfile } from '@/components/layout/UserAvatar'
import { useAuth } from '@/hooks/useAuth'
import styles from './DashboardLayout.module.css'

const ADMIN_ITEMS: SidebarItem[] = [
  { label: 'Overview', icon: 'fas fa-gauge-high', to: '/admin', end: true },
  { label: 'Bot Health', icon: 'fas fa-heart-pulse', to: '/admin/health' },
  { label: 'Channels', icon: 'fas fa-tv', to: '/admin/channels' },
  { label: 'Users', icon: 'fas fa-users', to: '/admin/users' },
  { label: 'Message Bot', icon: 'fas fa-paper-plane', to: '/admin/message' },
  { label: 'Drops', icon: 'fas fa-gift', to: '/admin/drops' },
  { label: 'Audit', icon: 'fas fa-shield-halved', to: '/admin/audit' },
  { label: 'Exit to Dashboard', icon: 'fas fa-arrow-left', to: '/dashboard', variant: 'accent' },
]

export function AdminLayout() {
  const { user } = useAuth()
  return (
    <div className={styles.container}>
      <Sidebar
        items={ADMIN_ITEMS}
        logo={<Logo to="/admin" />}
        footer={user && <UserProfile name={user.username} role={user.role} />}
      />
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}
