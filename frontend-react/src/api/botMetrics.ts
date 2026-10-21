/* Bot metrics (METRICS_PASSWORD-gated) service. */
import { api } from './api'
import type { BotMetricsRange, BotMetricsResponse } from '@/types/botMetrics'

export const botMetricsApi = {
  /** Live bot vitals + command/chat graphs. 401 when the metrics session is missing. */
  get: (range: BotMetricsRange) =>
    api.get<BotMetricsResponse>('/api/internal/metrics', { params: { range } }),
}

/** Backend password login that grants the metrics session. */
export const BOT_METRICS_LOGIN_URL = '/botmetrics/login'
