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

export interface PerformancePoint {
  timestamp: string
  cpuUsage: number
  memoryUsed: number
  botLatencyMs: number
  connectedChannels: number
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
