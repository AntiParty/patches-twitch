/* Auth + subscription service. Wraps the existing backend endpoints. */
import { api } from './api'
import type { AuthStatus, SubscriptionStatus } from '@/types/auth'

export const authApi = {
  /** Current login status. Public endpoint — safe to call when logged out. */
  getStatus: () => api.get<AuthStatus>('/api/auth/status'),

  /** Subscription/premium status. Auth-gated; only call when authenticated. */
  getSubscriptionStatus: () =>
    api.get<SubscriptionStatus>('/api/subscription/status'),
}

/** Full-page redirects for the OAuth flow (backend-owned routes). */
export const authRoutes = {
  login: '/login',
  reauth: '/reauth',
}
