/*
 * AuthProvider — single source of truth for client-side auth state.
 *
 * Loads GET /api/auth/status (public). When authenticated, also loads
 * GET /api/subscription/status to surface premium/custom-bot state. Both are
 * cached via TanStack Query so the rest of the app reads from one place.
 *
 * Session/cookie/CSRF behavior is unchanged from the legacy app — this just
 * reflects backend state into React.
 */
import { useCallback, useMemo, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { authApi, authRoutes } from '@/api/auth'
import { ApiError } from '@/api/errors'
import type { CurrentUser, SubscriptionStatus } from '@/types/auth'
import { AuthContext, BYPASS_ROLES, type AuthContextValue } from './auth-context'

const AUTH_KEY = ['auth', 'status'] as const
const SUB_KEY = ['auth', 'subscription'] as const

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()

  const statusQuery = useQuery({
    queryKey: AUTH_KEY,
    queryFn: authApi.getStatus,
    staleTime: 60_000,
    retry: false,
  })

  const isAuthenticated = statusQuery.data?.isAuthenticated ?? false

  const subQuery = useQuery({
    queryKey: SUB_KEY,
    queryFn: authApi.getSubscriptionStatus,
    enabled: isAuthenticated,
    staleTime: 60_000,
    // A 401 here just means "not premium-visible"; don't hammer it.
    retry: (count, err) => !(err instanceof ApiError && err.isUnauthorized) && count < 1,
  })

  const user = useMemo<CurrentUser | null>(() => {
    if (!isAuthenticated || !statusQuery.data?.username) return null
    const role = statusQuery.data.role ?? 'Basic user'
    const sub: Partial<SubscriptionStatus> = subQuery.data ?? {}
    const hasRoleBypass = BYPASS_ROLES.includes(role)
    return {
      username: statusQuery.data.username,
      role,
      isAdmin: role === 'admin',
      hasSubscription: Boolean(sub.hasSubscription) || hasRoleBypass,
      subscriptionTier: sub.subscriptionTier ?? null,
      tierName: sub.tierName ?? null,
      customBot: sub.customBot ?? null,
    }
  }, [isAuthenticated, statusQuery.data, subQuery.data])

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['auth'] })
  }, [queryClient])

  const login = useCallback(() => {
    window.location.href = authRoutes.login
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated,
      isLoading: statusQuery.isLoading,
      role: user?.role ?? null,
      isAdmin: user?.isAdmin ?? false,
      hasSubscription: user?.hasSubscription ?? false,
      hasRoleBypass: user ? BYPASS_ROLES.includes(user.role) : false,
      refresh,
      login,
    }),
    [user, isAuthenticated, statusQuery.isLoading, refresh, login],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
