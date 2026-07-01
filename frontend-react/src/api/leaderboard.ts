/* Public leaderboard service. */
import { api } from './api'
import type { LeaderboardResponse } from '@/types/leaderboard'

export const leaderboardApi = {
  get: () => api.get<LeaderboardResponse>('/api/leaderboard'),
}

/** League filter buttons (ranked top players only reach Platinum 2+). */
export const LEAGUE_FILTERS = [
  'All',
  'Ruby',
  'Diamond 1',
  'Diamond 2',
  'Diamond 3',
  'Diamond 4',
  'Platinum 1',
  'Platinum 2',
]
