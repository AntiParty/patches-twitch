/* Onboarding wizard endpoints. */
import { api } from './api'

export interface IgnLookup {
  found: boolean
  name?: string
  rank?: number
  rankScore?: number
  league?: string
}

export const onboardingApi = {
  /** Read-only leaderboard preview for the wizard's live validation. */
  lookup: (ign: string) =>
    api.get<IgnLookup>('/api/onboarding/lookup', { params: { ign } }),

  /** Mark the first-run wizard complete (finish or skip). */
  complete: () => api.post<{ success: boolean }>('/api/onboarding/complete'),
}
