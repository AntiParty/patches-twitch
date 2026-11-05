/* Public TTK service. */
import { api } from './api'
import type { TtkResponse } from '@/types/ttk'

export const ttkApi = {
  get: () => api.get<TtkResponse>('/api/ttk'),
}
