/** Leaderboard shapes. */
export interface LeaderboardEntry {
  rank: number
  name: string
  league: string
  rankScore?: number
  change?: number
  clubTag?: string
  steamName?: string
  psnName?: string
  xboxName?: string
}

/** GET /api/leaderboard */
export interface LeaderboardResponse {
  season: number
  mode: string
  updated: string
  /** Bot's last/next leaderboard poll; null until the bot has polled once. */
  lastCheckedAt: string | null
  nextCheckAt: string | null
  data: LeaderboardEntry[]
}
