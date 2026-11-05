/* Shapes returned by GET /api/internal/metrics (password-gated /botmetrics page). */

export type BotMetricsRange = '30m' | '1h' | '3h' | '6h'

export type BotStatus = 'operational' | 'degraded' | 'outage'

/** EventSub conduit: all shards up, some, none, or not configured on this bot. */
export type ConduitState = 'connected' | 'partial' | 'down' | 'off'

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
  conduitState: ConduitState | null
  conduitShardsAssigned: number | null
  conduitShardCount: number | null
  /** Channels reading chat over each transport right now. */
  ircChannels: number | null
  eventsubChannels: number | null
  /** Counters below are since the bot process started. */
  conduitSubscriptionsFailed: number | null
  conduitReconnects: number | null
  eventsubFallbacks: number | null
  chatDispatchErrors: number | null
  chatSendsQueued: number | null
  chatSendRetries: number | null
  chatSendsDropped: number | null
  commandCooldownHits: number | null
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
  /** Channels whose broadcaster disconnected the app on Twitch. */
  revokedChannels: number
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
