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
  { label: 'Bot Health', icon: 'fas fa-heart-pulse', to: '/admin/health', section: 'Operations' },
  { label: 'Probes', icon: 'fas fa-bug', to: '/admin/probes', section: 'Operations' },
  { label: 'Live Players', icon: 'fas fa-signal', to: '/admin/live-players', section: 'Operations' },
  { label: 'Audit', icon: 'fas fa-shield-halved', to: '/admin/audit', section: 'Operations' },
  { label: 'Channels', icon: 'fas fa-tv', to: '/admin/channels', section: 'Community' },
  { label: 'Users', icon: 'fas fa-users', to: '/admin/users', section: 'Community' },
  { label: 'Message Bot', icon: 'fas fa-paper-plane', to: '/admin/message', section: 'Community' },
  { label: 'Drops', icon: 'fas fa-gift', to: '/admin/drops', section: 'Content' },
  { label: 'Trolls', icon: 'fas fa-masks-theater', to: '/admin/trolls', section: 'Content' },
  { label: 'Balance', icon: 'fas fa-scale-balanced', to: '/admin/balance', section: 'Content' },
  { label: 'Exit to Dashboard', icon: 'fas fa-arrow-left', to: '/dashboard', variant: 'accent' },
]

// Staff can only reach the Trolls page (see App.tsx routes). A lone item needs no section label.
const STAFF_ITEMS: SidebarItem[] = ADMIN_ITEMS
  .filter((item) => item.to === '/admin/trolls' || item.to === '/dashboard')
  .map(({ section: _section, ...item }) => item)

export function AdminLayout() {
  const { user, isAdmin } = useAuth()
  return (
    <div className={styles.container}>
      <Sidebar
        items={isAdmin ? ADMIN_ITEMS : STAFF_ITEMS}
        logo={<Logo to={isAdmin ? '/admin' : '/admin/trolls'} />}
        footer={user && <UserProfile name={user.username} role={user.role} />}
      />
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}
