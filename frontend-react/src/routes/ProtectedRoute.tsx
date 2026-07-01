/*
 * Route guard. Mirrors the backend's requireUser / requireAdmin / requireSubscription
 * gates on the client for UX (the backend remains the real authority).
 *
 *  - Not authenticated  -> redirect to Twitch login (full page, backend-owned)
 *  - Missing role/sub   -> redirect to a fallback route
 */
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { authRoutes } from '@/api/auth'

interface ProtectedRouteProps {
  children: ReactNode
  /** Require admin role. */
  requireAdmin?: boolean
  /** Require premium (subscription or bypass role). */
  requireSubscription?: boolean
  /** Where to send users who are logged in but lack permission. */
  fallback?: string
}

export function ProtectedRoute({
  children,
  requireAdmin = false,
  requireSubscription = false,
  fallback = '/',
}: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, isAdmin, hasSubscription } = useAuth()
  const location = useLocation()

  if (isLoading) {
    // Foundation placeholder; replaced by a real loading screen in Phase 3.
    return <div style={{ padding: 24, color: 'var(--text-muted)' }}>Loading…</div>
  }

  if (!isAuthenticated) {
    // Send to backend OAuth, preserving where the user wanted to go.
    sessionStorage.setItem('postLoginRedirect', location.pathname + location.search)
    window.location.href = authRoutes.login
    return null
  }

  if (requireAdmin && !isAdmin) return <Navigate to={fallback} replace />
  if (requireSubscription && !hasSubscription) return <Navigate to="/subscribe" replace />

  return <>{children}</>
}
