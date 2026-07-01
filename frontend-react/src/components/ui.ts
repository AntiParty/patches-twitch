/*
 * Shared UI component library barrel.
 * Import primitives from here: `import { Button, Card, useToast } from '@/components/ui'`
 */

// Buttons
export { Button } from './buttons/Button'

// Cards
export { Card } from './cards/Card'
export { StatCard } from './cards/StatCard'

// Forms
export { Field } from './forms/Field'
export { Input } from './forms/Input'
export { Textarea } from './forms/Textarea'
export { Select, type SelectOption } from './forms/Select'
export { SearchBar } from './forms/SearchBar'

// Tables
export { Table, type Column } from './tables/Table'

// Data display
export { Badge } from './data-display/Badge'
export { RoleBadge, PremiumBadge } from './data-display/RoleBadge'
export { ProgressBar } from './data-display/ProgressBar'
export { Tabs, type TabItem } from './data-display/Tabs'
export { Dropdown, type DropdownItem } from './data-display/Dropdown'

// Feedback
export { Spinner } from './feedback/Spinner'
export { Skeleton } from './feedback/Skeleton'
export { EmptyState } from './feedback/EmptyState'
export { ErrorState } from './feedback/ErrorState'

// Modals / overlays
export { Dialog } from './modals/Dialog'

// Layout helpers
export { PageHeader } from './layout/PageHeader'
export { NotificationBanner } from './layout/NotificationBanner'
export { UserAvatar, UserProfile } from './layout/UserAvatar'

// Hooks (provider-backed)
export { useToast } from '@/hooks/useToast'
export { useConfirm } from '@/hooks/useConfirm'
