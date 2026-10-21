/* Shapes returned by GET /api/internal/metrics (password-gated /botmetrics page). */

export type BotMetricsRange = '30m' | '1h' | '3h' | '6h'

export type BotStatus = 'operational' | 'degraded' | 'outage'

/** Live bot vitals from the bot Control API. Null = the bot didn't report it. */
export interface BotLiveStatus {
  status: BotStatus
  controlApiReachable: boolean
  controlApiLatencyMs: number | null
  uptimeSeconds: number | null
  rssBytes: number | null
  heapUsedBytes: number | null
  connectedChannels: number | null
  reconnectingChannels: number | null
  eventSubConnected: boolean | null
  databaseLatencyMs: number | null
  cacheAgeSeconds: number | null
}

export interface BotMetricsResponse {
  observedAt: string
  bot: BotLiveStatus
  channels: number
  liveChannels: number
  activeSessions: number
  usersSeen: number
  commandsToday: number
  commandsFailedToday: number
  successRate: number
  minuteGraph: { minute: string; count: number }[]
  chatGraph: { minute: string; in: number; out: number }[]
  topChannels: { channel: string; count: number | string }[]
  topCommands: { command: string; count: number | string }[]
  range: BotMetricsRange
  bucketLabel: string
}
