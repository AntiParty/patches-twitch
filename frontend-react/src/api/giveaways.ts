/* Giveaways service: current status, create/draw/redraw/close (ticket type). */
import { api } from './api'
import type { GiveawayCurrentResponse, GiveawayWinner } from '@/types/giveaway'

export interface CreateTicketInput {
  prize: string
}

export interface RedeemStartInput {
  prize: string
  cost: number
  winnerCount: number
  prompt?: string
  backgroundColor?: string
  maxPerUserPerStream?: number
  maxPerStream?: number
  cooldownSeconds?: number
}

export interface UpdateGiveawayInput {
  prize?: string
  cost?: number
  winnerCount?: number
  prompt?: string
  backgroundColor?: string
  // 0 turns a limit off; omit to keep the reward's current setting.
  maxPerUserPerStream?: number
  maxPerStream?: number
  cooldownSeconds?: number
}

export const giveawaysApi = {
  getCurrent: () => api.get<GiveawayCurrentResponse>('/api/user/giveaways/current'),
  create: (input: CreateTicketInput) => api.post('/api/user/giveaways', input),
  update: (input: UpdateGiveawayInput) => api.post('/api/user/giveaways/update', input),
  draw: () => api.post<{ winner: GiveawayWinner }>('/api/user/giveaways/draw', {}),
  redraw: () => api.post<{ winner: GiveawayWinner }>('/api/user/giveaways/redraw', {}),
  announce: () => api.post('/api/user/giveaways/announce', {}),
  lock: () => api.post('/api/user/giveaways/lock', {}),
  close: () => api.post('/api/user/giveaways/close', {}),
  pause: () => api.post('/api/user/giveaways/pause', {}),
  resume: () => api.post('/api/user/giveaways/resume', {}),
  reset: () => api.post('/api/user/giveaways/reset', {}),
  redeemStart: (input: RedeemStartInput) => api.post('/api/user/giveaways/redeem/start', input),
  redeemClose: () => api.post('/api/user/giveaways/redeem/close', {}),
}
