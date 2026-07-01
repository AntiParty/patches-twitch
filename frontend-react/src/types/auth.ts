/** Shapes returned by the backend auth/subscription endpoints. */

export type UserRole = 'Basic user' | 'subscriber' | 'tester' | 'Staff' | 'admin' | string

/** Response of GET /api/auth/status */
export interface AuthStatus {
  isAuthenticated: boolean
  username?: string
  role?: UserRole
}

export interface CustomBotSummary {
  username: string
  isActive: boolean
}

/** Response of GET /api/subscription/status */
export interface SubscriptionStatus {
  hasSubscription: boolean
  subscriptionTier: number | null
  tierName: string | null
  customBot: CustomBotSummary | null
}

/** Aggregated, view-friendly auth state exposed by AuthProvider. */
export interface CurrentUser {
  username: string
  role: UserRole
  isAdmin: boolean
  hasSubscription: boolean
  subscriptionTier: number | null
  tierName: string | null
  customBot: CustomBotSummary | null
}
