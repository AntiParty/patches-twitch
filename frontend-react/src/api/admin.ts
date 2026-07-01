/* Admin panel service (all endpoints under /admin, admin-role gated). */
import { api } from './api'
import { http } from './http'
import type {
  AdminUser,
  AdminChannel,
  AuditEvent,
  OperationsOverview,
  BotHealth,
  DropsConfig,
} from '@/types/admin'

export const adminApi = {
  getUsers: (search?: string) =>
    api.get<{ users: AdminUser[] }>('/admin/api/users', { params: search ? { search } : undefined }),
  getChannels: () => api.get<{ channels: AdminChannel[] }>('/admin/api/channels'),

  setRole: (id: number, role: string) =>
    api.post(`/admin/api/users/${id}/set-role`, { role }),
  banUser: (id: number, reason: string) => api.post(`/admin/api/users/${id}/ban`, { reason }),
  unbanUser: (id: number) => api.post(`/admin/api/users/${id}/unban`),
  grantSubscription: (id: number, tier = 'custom_bot', durationDays = 30) =>
    api.post(`/admin/api/users/${id}/grant-subscription`, { tier, durationDays }),
  revokeSubscription: (id: number) => api.post(`/admin/api/users/${id}/revoke-subscription`),

  getAudit: (limit = 50) =>
    api.get<{ events: AuditEvent[] }>('/admin/api/operations/audit', { params: { limit } }),

  sendMessage: (channels: string[], message: string) =>
    api.post('/admin/api/message', { channels, message }),

  getOverview: (range = '24h') =>
    api.get<OperationsOverview>('/admin/api/operations/overview', { params: { range } }),
  getHealth: (range = '24h') =>
    api.get<BotHealth>('/admin/api/operations/health', { params: { range } }),

  getDrops: () => api.get<DropsConfig>('/admin/api/drops'),
  saveDrops: (config: DropsConfig) => api.post<{ success: boolean; config: DropsConfig }>('/admin/api/drops', config),
  uploadDropImage: (file: File) => {
    const form = new FormData()
    form.append('image', file)
    return http.post<{ success: boolean; url: string }>('/admin/api/upload', form).then((r) => r.data)
  },
}
