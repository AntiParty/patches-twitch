/** Admin panel shapes. */

export type AdminRole = 'Basic user' | 'tester' | 'analyst' | 'Staff' | 'admin'
export const ADMIN_ROLES: AdminRole[] = ['Basic user', 'tester', 'analyst', 'Staff', 'admin']

export interface AdminUser {
  id: number
  username: string
  role: AdminRole | string
  botEnabled: boolean
  banned: boolean
  banReason: string | null
  hasSubscription: boolean
  subscriptionTier: string | null
}

export interface AdminChannel {
  id: number
  username: string
  role: string
  botEnabled: boolean
  banned: boolean
}

export interface OperationalEvent {
  id?: number
  type: string
  severity?: 'info' | 'warning' | 'critical'
  channel?: string | null
  durationMs?: number | null
  attemptCount?: number | null
  reasonCode?: string | null
  outcome?: string | null
  timestamp?: string
}

export interface OperationsOverview {
  observedAt: string
  status: string
  bot: { controlApiReachable: boolean; latencyMs: number | null; uptimeSeconds: number | null }
  channels: { connected: number; expected: number; reconnecting: number }
  commands: {
    allTime: number
    rangedTotal: number
    today: number
    failures: number
    failureRate: number
    activeCommands: { command: string; count: number }[]
    trend: { timestamp: string; commands: number }[]
  }
  throughput: { timestamp: string; chatIn: number; chatOut: number }[]
  services: { eventSubHealthy: boolean; cacheAgeSeconds: number | null }
  incidents: OperationalEvent[]
}

export interface PerformancePoint {
  timestamp: string
  cpuUsage: number | null
  memoryUsed: number | null
  heapUsed: number | null
  botLatencyMs: number | null
  connectedChannels: number | null
}

export type BotHealth = OperationsOverview & { performanceHistory: PerformancePoint[] }

export interface DropItem {
  name: string
  category: string
  duration: string
}
export interface DropsConfig {
  lastUpdated: string
  featuredImage: string
  endsAt: string
  drops: DropItem[]
}

export interface AuditEvent {
  timestamp?: string
  createdAt?: string
  actor?: string
  actorRole?: string
  role?: string
  action: string
  target?: string
  outcome?: string
  [key: string]: unknown
}

/* Vulnerability-scanner probes (/admin/api/operations/probes). */
export type ProbeRange = '7d' | '30d' | '365d'

export interface ProbeReport {
  range: ProbeRange
  days: number
  /** Paths/sources/unique counts cover at most this many days (detail retention). */
  detailDays: number
  generatedAt: string
  totals: { requests: number; today: number; sources: number }
  series: { day: string; total: number; byCategory: Record<string, number> }[]
  categories: { category: string; label: string; reference?: string; count: number; sources: number }[]
  topPaths: { path: string; category: string; count: number; lastDay: string }[]
  topSources: {
    sourceHash: string
    sourcePrefix: string | null
    count: number
    categories: string[]
    firstDay: string
    lastDay: string
  }[]
  recent: {
    timestamp: string
    category: string
    rule: string
    method: string
    url: string
    statusCode: number | null
    sourcePrefix: string | null
    sourceHash: string
    userAgent: string | null
  }[]
}
