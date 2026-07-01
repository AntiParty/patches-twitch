/* Public (unauthenticated) data services. */
import { api } from './api'
import type { DropsConfig } from '@/types/admin'

export interface ActiveStreamer {
  channel: string
  thumbnail_url?: string
}

export const publicApi = {
  /** Public drops config (static file served by the backend). */
  getDrops: () => api.get<DropsConfig>(`/drops.json?t=${Date.now()}`),

  /** Channels currently live in THE FINALS. */
  getActiveStreamers: () => api.get<ActiveStreamer[]>('/api/active-streamers'),
}
