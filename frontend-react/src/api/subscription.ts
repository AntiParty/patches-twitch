/* Subscription / custom bot service. */
import { api } from './api'
import type { SubscriptionStatus } from '@/types/auth'

export interface RefreshResponse {
  success: boolean
  needsReauth?: boolean
  reauthUrl?: string
  message?: string
  hasSubscription?: boolean
  subscriptionTier?: number | null
  tierName?: string | null
}

export const subscriptionApi = {
  getStatus: () => api.get<SubscriptionStatus>('/api/subscription/status'),

  /** Re-check the Twitch subscription and update premium state. */
  refresh: () => api.post<RefreshResponse>('/api/subscription/refresh'),

  /** OAuth URL to authorize a custom bot account (copyable). */
  getCustomBotAuthUrl: () => api.get<{ url: string }>('/api/subscription/custom-bot-auth-url'),

  /** Unlink the custom bot, reverting to the default account. */
  unlinkBot: () => api.post<{ success: boolean }>('/api/subscription/unlink-bot'),
}
