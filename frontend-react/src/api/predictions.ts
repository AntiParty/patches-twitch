/* Predictions service: presets CRUD, live prediction, automation. */
import { api } from './api'
import type {
  PredictionPreset,
  PredictionAuthStatus,
  ActivePrediction,
  AutomationConfig,
  AutomationResponse,
} from '@/types/prediction'

export interface PresetInput {
  alias: string
  title: string
  outcomes: string[]
  durationSeconds: number
}

export interface AutomationInput {
  enabled: boolean
  mode: string
  startDelaySeconds: number
  votingWindowSeconds: number
  question: string
  outcomes: AutomationConfig['outcomes']
}

export const predictionsApi = {
  // Presets
  listPresets: () => api.get<{ presets: PredictionPreset[] }>('/api/user/prediction-presets'),
  createPreset: (input: PresetInput) => api.post('/api/user/prediction-presets', input),
  updatePreset: (alias: string, input: PresetInput) =>
    api.put(`/api/user/prediction-presets/${encodeURIComponent(alias)}`, input),
  deletePreset: (alias: string) =>
    api.del(`/api/user/prediction-presets/${encodeURIComponent(alias)}`),

  // Live prediction
  getStatus: () => api.get<PredictionAuthStatus>('/api/user/predictions/status'),
  getCurrent: () => api.get<{ prediction: ActivePrediction | null }>('/api/user/predictions/current'),
  start: (alias: string) =>
    api.post<{ prediction: ActivePrediction }>('/api/user/predictions/start', { alias }),
  resolve: (selection: number | string) =>
    api.post('/api/user/predictions/resolve', { selection }),
  cancel: () => api.post('/api/user/predictions/cancel', {}),

  // Automation (premium-gated)
  getAutomation: () => api.get<AutomationResponse>('/api/user/predictions/automation'),
  saveAutomation: (input: AutomationInput) =>
    api.put<{ config: AutomationConfig }>('/api/user/predictions/automation', input),
  startAutomation: () => api.post('/api/user/predictions/automation/start', {}),
  cancelAutomation: () => api.post('/api/user/predictions/automation/cancel', {}),
}

// Automation preset outcomes per mode (mirrors the legacy constants).
export const NEXT_RESULT_OUTCOMES = [
  { label: 'Lose RS', minDelta: null, maxDelta: -1 },
  { label: 'Gain RS', minDelta: 1, maxDelta: null },
]
export const STREAM_TOTAL_OUTCOMES = [
  { label: 'Down 500+', minDelta: null, maxDelta: -500 },
  { label: 'Roughly even', minDelta: -499, maxDelta: 499 },
  { label: 'Up 500+', minDelta: 500, maxDelta: 999 },
  { label: 'Up 1000+', minDelta: 1000, maxDelta: null },
]

export const AUTOMATION_DELAYS = [
  { value: 300, label: '5 minutes' },
  { value: 480, label: '8 minutes' },
  { value: 600, label: '10 minutes' },
  { value: 900, label: '15 minutes' },
  { value: 1200, label: '20 minutes' },
  { value: 1800, label: '30 minutes' },
]
