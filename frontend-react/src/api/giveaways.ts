/* Giveaways service: current status, create/draw/redraw/close (ticket type). */
import { api } from './api'
import type { GiveawayCurrentResponse, GiveawayWinner } from '@/types/giveaway'

export interface CreateTicketInput {
  prize: string
  maxTicketsPerUser: number
}

export interface RedeemStartInput {
  prize: string
  cost: number
}

export const giveawaysApi = {
  getCurrent: () => api.get<GiveawayCurrentResponse>('/api/user/giveaways/current'),
  create: (input: CreateTicketInput) => api.post('/api/user/giveaways', input),
  draw: () => api.post<{ winner: GiveawayWinner }>('/api/user/giveaways/draw', {}),
  redraw: (excludePrevWinner: boolean) =>
    api.post<{ winner: GiveawayWinner }>('/api/user/giveaways/redraw', { excludePrevWinner }),
  close: () => api.post('/api/user/giveaways/close', {}),
  pause: () => api.post('/api/user/giveaways/pause', {}),
  resume: () => api.post('/api/user/giveaways/resume', {}),
  reset: () => api.post('/api/user/giveaways/reset', {}),
  redeemStart: (input: RedeemStartInput) => api.post('/api/user/giveaways/redeem/start', input),
  redeemClose: () => api.post('/api/user/giveaways/redeem/close', {}),
}
