/* Statistics (analyst-gated) service. */
import { api } from './api'
import type { StatisticsResponse } from '@/types/statistics'

export const statisticsApi = {
  /** Combined analytics. 403 when the session lacks the analyst/admin role. */
  get: () => api.get<StatisticsResponse>('/api/statistics'),
}

/** Backend password login that grants the analyst session. */
export const STATISTICS_LOGIN_URL = '/statistics/login'
