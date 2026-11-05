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
  /** Linked THE FINALS Embark id (Channel.player_id), e.g. "Name#1234". */
  finalsAccount: string | null
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

/* Ranked players whose RS moved recently (/admin/api/operations/live-players). */
export interface LivePlayer {
  name: string
  clubTag: string
  rank: number
  rankScore: number
  leagueNumber: number
  league: string
  /** RS now minus RS just before the window. */
  delta: number
  /** Board refreshes in the window where the player's RS changed. */
  moves: number
  firstMoveAt: string
  lastMoveAt: string
}

export interface LivePlayersReport {
  season: number | null
  windowMinutes: number
  top: number
  generatedAt: string
  lastSnapshotAt: string | null
  totals: { active: number; top100: number; top500: number }
  players: LivePlayer[]
}

export interface TrollResponse {
  id: number
  /** Command name without '!', or '*' for any command. */
  command: string
  /** null = every armed channel. */
  channel: string | null
  response: string
  chance: number
  followUp: boolean
  enabled: boolean
  createdBy: string | null
  createdAt: string
}

export interface TrollsConfig {
  trolls: TrollResponse[]
  armedChannels: string[]
  channels: string[]
  commands: string[]
  placeholders: string[]
}

export interface NewTroll {
  command: string
  channel: string | null
  response: string
  chance: number
  followUp: boolean
}

export interface BalanceChange {
  id: number
  source: 'patch' | 'wiki'
  patchGid: string | null
  kind: 'weapon' | 'class' | 'other'
  target: string
  rawTarget: string | null
  field: string | null
  statLabel: string
  fromValue: number | null
  toValue: number
  currentValue: number | null
  rawLine: string | null
  status: 'pending' | 'applied' | 'rejected' | 'info'
  fromMismatch: boolean
  confirmedByWiki: boolean
  confirmedByPatch: boolean
  decidedBy: string | null
  decidedAt: string | null
  createdAt: string
}

export interface BalancePatch {
  gid: string
  title: string
  url: string
  postedAt: string
  status: 'baseline' | 'no_balance' | 'pending' | 'reviewed'
  unparsed: Array<{ category: string; target: string; line: string }>
}

export interface TtkCell {
  shots: number
  seconds: number | null
}

export interface TtkRow {
  mode: string
  hit: 'body' | 'head'
  byBuild: Record<'Light' | 'Medium' | 'Heavy', TtkCell>
}

export interface TtkWeapon {
  name: string
  build: string | null
  wtype: string | null
  notes: string[]
  rows: TtkRow[]
}

export interface BalanceData {
  pending: BalanceChange[]
  info: BalanceChange[]
  recent: BalanceChange[]
  patches: BalancePatch[]
  weapons: Array<{ name: string; build: string | null; wtype: string | null; fields: string[] }>
  fieldLabels: Record<string, string>
  health: Record<'Light' | 'Medium' | 'Heavy', number> | null
  ttk: TtkWeapon[]
  wiki: { baseUrl: string; name: string; license: { name: string; url: string } }
  lastWikiSync: string | null
  lastSteamPoll: string | null
  wikiSkipped: string[]
}

export interface BalanceApproveOverrides {
  target?: string
  field?: string
  toValue?: number
}

export interface BalanceSyncResult {
  newPatches: number
  wiki: { weaponsAdded: number; changesCreated: number; changesConfirmed: number; seeded: boolean } | null
  errors: string[]
}
