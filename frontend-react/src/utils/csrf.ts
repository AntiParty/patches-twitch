/*
 * CSRF token handling.
 *
 * The Express backend uses `csurf` with the secret stored in the session
 * (cookie:false). A valid token is obtained from an authenticated endpoint and
 * sent back on every state-changing request via the `X-CSRF-Token` header
 * (one of the header names csurf accepts by default).
 *
 * We fetch the token lazily, cache it for the session, and allow callers to
 * invalidate it (e.g. after a 403 EBADCSRFTOKEN) so the next request refetches.
 *
 * NOTE: uses bare `fetch` (not the shared axios client) to avoid a circular
 * dependency with the request interceptor that injects this token.
 */

// Endpoint that returns { csrfToken }. Auth-gated on the backend, which is fine:
// mutations only happen for authenticated users.
const CSRF_ENDPOINT = '/api/subscription/csrf-token'

export const CSRF_HEADER = 'X-CSRF-Token'

let cachedToken: string | null = null
let inflight: Promise<string | null> | null = null

async function requestToken(): Promise<string | null> {
  try {
    const res = await fetch(CSRF_ENDPOINT, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { csrfToken?: string }
    cachedToken = data.csrfToken ?? null
    return cachedToken
  } catch {
    return null
  } finally {
    inflight = null
  }
}

/** Return a CSRF token, fetching+caching it on first use. Deduplicates concurrent calls. */
export async function getCsrfToken(): Promise<string | null> {
  if (cachedToken) return cachedToken
  if (!inflight) inflight = requestToken()
  return inflight
}

/** Force the next getCsrfToken() to refetch (call after a rejected token). */
export function invalidateCsrfToken(): void {
  cachedToken = null
}
