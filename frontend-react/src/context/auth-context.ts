/* The AuthContext object + its value type. Kept separate from the provider
 * component so hooks can import the context without pulling in component code
 * (keeps React Fast Refresh happy). */
import { createContext } from 'react'
import type { CurrentUser, UserRole } from '@/types/auth'

export interface AuthContextValue {
  /** Resolved user, or null when logged out. */
  user: CurrentUser | null
  isAuthenticated: boolean
  /** True while the initial auth status is loading. */
  isLoading: boolean
  role: UserRole | null
  isAdmin: boolean
  hasSubscription: boolean
  /** True for roles that bypass premium gating (subscriber/tester/Staff/admin). */
  hasRoleBypass: boolean
  /** Re-fetch auth + subscription status. */
  refresh: () => Promise<void>
  /** Redirect to the Twitch OAuth login. */
  login: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export const BYPASS_ROLES: UserRole[] = ['subscriber', 'tester', 'Staff', 'admin']
