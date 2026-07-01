/*
 * Friendly request surface over the axios `http` client.
 * Returns parsed response bodies directly and throws ApiError on failure.
 *
 * Usage:
 *   const profile = await api.get<Profile>('/api/user/profile')
 *   await api.post('/api/my-commands', { name, response })
 *
 * Feature-specific calls should live in dedicated service files (auth.ts,
 * dashboard.ts, ...) that build on top of this.
 */
import type { AxiosRequestConfig } from 'axios'
import { http } from './http'

export const api = {
  get: <T = unknown>(url: string, config?: AxiosRequestConfig) =>
    http.get<T>(url, config).then((r) => r.data),

  post: <T = unknown>(url: string, body?: unknown, config?: AxiosRequestConfig) =>
    http.post<T>(url, body, config).then((r) => r.data),

  put: <T = unknown>(url: string, body?: unknown, config?: AxiosRequestConfig) =>
    http.put<T>(url, body, config).then((r) => r.data),

  patch: <T = unknown>(url: string, body?: unknown, config?: AxiosRequestConfig) =>
    http.patch<T>(url, body, config).then((r) => r.data),

  del: <T = unknown>(url: string, config?: AxiosRequestConfig) =>
    http.delete<T>(url, config).then((r) => r.data),
}

export { http } from './http'
export { ApiError } from './errors'
