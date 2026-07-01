/* Dashboard account/bot service. Wraps existing backend endpoints. */
import { api } from './api'
import type { ChannelProfile, ToggleBotResponse } from '@/types/dashboard'

export const dashboardApi = {
  /** Channel profile (bot state, linked player id, token health). */
  getProfile: () => api.get<ChannelProfile>('/api/me'),

  /** Link THE FINALS player id (Embark "Name#1234"). */
  linkAccount: (playerId: string) =>
    api.post<{ success: boolean }>('/api/link-account', { playerId }),

  /** Toggle the bot on/off for the channel. */
  toggleBot: () => api.post<ToggleBotResponse>('/api/toggle-bot'),

  /** Remove the bot, custom commands, and session. */
  disconnectBot: () => api.post<{ success: boolean }>('/api/disconnect-bot'),
}
