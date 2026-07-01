/*
 * Centralized API client. Every request to the Express backend goes through
 * this axios instance. No component or feature service should call `fetch`
 * directly — import `http` (or a feature service) instead.
 *
 * Responsibilities:
 *  - send the session cookie (withCredentials)
 *  - inject the CSRF token on mutating requests
 *  - retry once on a CSRF token rejection (token rotated/expired)
 *  - normalize all failures into a typed ApiError
 */
import axios from 'axios'
import type { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { ApiError } from './errors'
import { CSRF_HEADER, getCsrfToken, invalidateCsrfToken } from '@/utils/csrf'

const MUTATING = new Set(['post', 'put', 'patch', 'delete'])

// Augment config so we can flag a request that already retried after CSRF failure.
type RetryConfig = InternalAxiosRequestConfig & { _csrfRetried?: boolean }

export const http = axios.create({
  baseURL: '', // same-origin; Vite proxies backend paths in dev
  withCredentials: true,
  headers: { Accept: 'application/json' },
})

// --- Request interceptor: attach CSRF token on mutating requests ---
http.interceptors.request.use(async (config) => {
  const method = (config.method ?? 'get').toLowerCase()
  if (MUTATING.has(method)) {
    const token = await getCsrfToken()
    if (token) config.headers.set(CSRF_HEADER, token)
  }
  return config
})

function toApiError(error: AxiosError): ApiError {
  const res = error.response
  if (!res) {
    return new ApiError(error.message || 'Network error', 0)
  }
  const body = res.data as { error?: string; message?: string; code?: string } | undefined
  const message = body?.error || body?.message || error.message || `Request failed (${res.status})`
  return new ApiError(message, res.status, body?.code, res.data)
}

// --- Response interceptor: CSRF retry + error normalization ---
http.interceptors.response.use(
  (res: AxiosResponse) => res,
  async (error: AxiosError) => {
    const config = error.config as RetryConfig | undefined
    const status = error.response?.status
    const bodyError = (error.response?.data as { error?: string } | undefined)?.error ?? ''

    // csurf returns 403 with "Invalid CSRF token". Refresh token and retry once.
    const isCsrfFailure = status === 403 && /csrf/i.test(bodyError)
    if (isCsrfFailure && config && !config._csrfRetried) {
      config._csrfRetried = true
      invalidateCsrfToken()
      const token = await getCsrfToken()
      if (token) {
        config.headers.set(CSRF_HEADER, token)
        return http.request(config)
      }
    }

    return Promise.reject(toApiError(error))
  },
)
