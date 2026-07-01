/** Prediction tab shapes (presets, live prediction, automation). */

export interface PredictionPreset {
  alias: string
  title: string
  outcomes: string[]
  durationSeconds: number
}

export type PredictionAuthState =
  | 'ready'
  | 'reauth_required'
  | 'unavailable'
  | 'temporarily_unavailable'

export interface PredictionAuthStatus {
  state: PredictionAuthState
  message?: string
  reauthUrl?: string
}

export interface PredictionOutcome {
  id: string
  title: string
}

export interface ActivePrediction {
  id: string
  title: string
  status: string
  outcomes: PredictionOutcome[]
}

export type AutomationMode = 'stream_total' | 'next_result'

export interface AutomationOutcome {
  label: string
  minDelta: number | null
  maxDelta: number | null
}

export interface AutomationConfig {
  enabled: boolean
  mode: AutomationMode
  startDelaySeconds: number
  votingWindowSeconds: number
  question: string
  outcomes: AutomationOutcome[]
}

export interface AutomationRun {
  id: number
  streamId: string
  mode: string
  cycleIndex: number
  status: string
  predictionId: string | null
  failureReason: string | null
  baselineRs: number | null
}

export interface AutomationLive {
  isLive: boolean
  category: string | null
  startingRs: number | null
  latestRs: number | null
  delta: number | null
  secondsUntilStart: number | null
}

export interface AutomationResponse {
  config: AutomationConfig
  run: AutomationRun | null
  live: AutomationLive
}
