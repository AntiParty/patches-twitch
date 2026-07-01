/* Stream overlay token + config service. */
import { api } from './api'
import type { OverlayConfig, OverlayConfigInput, OverlayTokenResponse } from '@/types/overlay'

export const overlayApi = {
  /** Current overlay token (session-authenticated). */
  getToken: () => api.get<OverlayTokenResponse>('/api/overlay/token'),

  /** Rotate the token (invalidates existing overlay links). */
  regenerateToken: () => api.post<OverlayTokenResponse>('/api/overlay/regenerate-token'),

  /** Appearance/visibility config by token (public, CSRF-exempt). */
  getConfig: (token: string) => api.get<OverlayConfig>(`/api/overlay/config/${token}`),

  /** Save appearance/visibility config (session-authenticated). */
  saveConfig: (input: OverlayConfigInput) =>
    api.post<{ success: boolean }>('/api/overlay/config', input),

  /** Reset the stream session start RS. */
  resetSession: () => api.post<{ success: boolean }>('/api/overlay/reset-session'),
}

export const OVERLAY_THEMES = [
  { value: 'minimal', label: 'Minimal Shard' },
  { value: 'dark', label: 'Dark Rail' },
  { value: 'dark-slim', label: 'Dark Rail Slim' },
  { value: 'rank-focus', label: 'Rank Focus' },
  { value: 'neon', label: 'Neon Glow' },
  { value: 'glass', label: 'Glass Morphism' },
  { value: 'terminal', label: 'Retro Terminal' },
  { value: 'card', label: 'Clean Card' },
]

export const OVERLAY_LAYOUTS = [
  { value: 'compact', label: 'Compact (Horizontal)' },
  { value: 'wide', label: 'Wide (Spaced Out)' },
]
