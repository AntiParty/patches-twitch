/** Rank tracker shapes. */

export interface RankGoal {
  /** Dashboard tier 1–6, or 0 when the goal was set from chat with a finer target. */
  targetRank: number
  goalType?: 'league' | 'rs' | 'rank'
  label?: string
  targetRankScore: number | null
  startingRank: number | null
  startingRankScore: number | null
  createdAt: string
  achieved: boolean
  achievedAt: string | null
}

/** GET /api/my-rank-goal */
export interface RankGoalResponse {
  goal: RankGoal | null
}

/** GET /api/my-current-rank */
export interface CurrentRank {
  playerId: string
  rank: number | null
  league: string | null
  rankScore: number
}

export interface RubyThreshold {
  season: number | null
  league: string | null
  threshold: number | null
  player: string | null
  unlocked: boolean
}

/** GET /api/ruby-status */
export interface RubyStatusResponse {
  rubyAvailable: boolean
  rubyRankThreshold: RubyThreshold | null
  message?: string
  error?: string
}
