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
