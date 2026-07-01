/* Maps a user role / premium status to a styled Badge. */
import { Badge } from './Badge'
import type { UserRole } from '@/types/auth'

type BadgeVariant = 'default' | 'primary' | 'success' | 'danger' | 'warning' | 'info'

const ROLE_META: Record<string, { label: string; variant: BadgeVariant; icon?: string }> = {
  admin: { label: 'Admin', variant: 'danger', icon: 'fas fa-user-shield' },
  Staff: { label: 'Staff', variant: 'warning', icon: 'fas fa-user-gear' },
  tester: { label: 'Tester', variant: 'info', icon: 'fas fa-flask' },
  subscriber: { label: 'Subscriber', variant: 'primary', icon: 'fas fa-star' },
  'Basic user': { label: 'Member', variant: 'default' },
}

export function RoleBadge({ role }: { role: UserRole }) {
  const meta = ROLE_META[role] ?? { label: role, variant: 'default' as BadgeVariant }
  return (
    <Badge variant={meta.variant} icon={meta.icon}>
      {meta.label}
    </Badge>
  )
}

export function PremiumBadge() {
  return (
    <Badge variant="warning" icon="fas fa-crown">
      Premium
    </Badge>
  )
}
