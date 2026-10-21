/** Statistics dashboard shapes (GET /api/statistics). */
export interface WebAnalytics {
  totalRequests?: number
  uniqueVisitors?: number
  avgResponseTime?: number
}

export interface TopCommand {
  command: string
  count: number
  channels?: number
}

export interface CommandAnalytics {
  totalCommands?: number
  uniqueCommands?: number
  activeChannels?: number
  topCommands?: TopCommand[]
  dailyUsage?: { date: string; count: number }[]
}

export interface IgnStats {
  last7days?: number
  total?: number
}

export interface EndpointMetric {
  endpoint: string
  count: number
  avgResponseTime: number
}
export interface StatusMetric {
  statusCode: number
  count: number
}
export interface HourlyMetric {
  hour: string
  count: number
}

export interface Referral {
  source: string
  count: number
}

/** Bot process sample, averaged per 5-minute bucket. Null = no reading. */
export interface PerformancePoint {
  timestamp: string
  /** Process CPU, % of one core. */
  cpuUsage: number | null
  /** Process RSS, bytes. */
  memoryUsed: number | null
  heapUsed: number | null
  /** Mean event-loop delay, ms. */
  botLatencyMs: number | null
  connectedChannels: number | null
}

export interface StatisticsResponse {
  webAnalytics: WebAnalytics
  ignStats: IgnStats
  commandAnalytics: CommandAnalytics
  requestMetrics: {
    byEndpoint: EndpointMetric[]
    byStatus: StatusMetric[]
    hourlyDistribution: HourlyMetric[]
  }
  referrals: Referral[]
  performanceHistory: PerformancePoint[]
  timestamp: string
}
