/* Rank goal + current rank + Ruby cutoff service. */
import { api } from './api'
import type { RankGoalResponse, CurrentRank, RubyStatusResponse } from '@/types/rank'

export const rankApi = {
  getGoal: () => api.get<RankGoalResponse>('/api/my-rank-goal'),

  saveGoal: (input: { targetRank: number; targetRankScore: number | null; currentRS: number }) =>
    api.post<{ success: boolean }>('/api/my-rank-goal', input),

  deleteGoal: () => api.del<{ success: boolean }>('/api/my-rank-goal'),

  /** Linked player's current rank from the leaderboard cache (404 if unlinked). */
  getCurrentRank: () => api.get<CurrentRank>('/api/my-current-rank'),

  /** Live Top-500 / Ruby cutoff. Public endpoint. */
  getRubyStatus: () => api.get<RubyStatusResponse>('/api/ruby-status'),
}

// --- Rank reference data (mirrors the legacy dashboard constants) ---
export const RANK_NAMES: Record<number, string> = {
  1: 'Bronze',
  2: 'Silver',
  3: 'Gold',
  4: 'Platinum',
  5: 'Diamond',
  6: 'Ruby',
}

/** Lower RS bound per rank; Ruby (6) uses the live Top-500 cutoff (null). */
export const RANK_THRESHOLDS: Record<number, number | null> = {
  1: 0,
  2: 10000,
  3: 20000,
  4: 30000,
  5: 40000,
  6: null,
}

export const RANK_OPTIONS = [
  { value: 1, label: 'Bronze (0 - 9,999 RS)' },
  { value: 2, label: 'Silver (10,000 - 19,999 RS)' },
  { value: 3, label: 'Gold (20,000 - 29,999 RS)' },
  { value: 4, label: 'Platinum (30,000 - 39,999 RS)' },
  { value: 5, label: 'Diamond (40,000 - 49,999 RS)' },
  { value: 6, label: 'Ruby (Top 500)' },
]

export const RANK_MILESTONES = [
  { rank: 2, label: 'Silver', threshold: 10000 },
  { rank: 3, label: 'Gold', threshold: 20000 },
  { rank: 4, label: 'Platinum', threshold: 30000 },
  { rank: 5, label: 'Diamond', threshold: 40000 },
]
