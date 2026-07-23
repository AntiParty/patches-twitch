# Web and frontend

## Express composition

`src/index.ts` waits for the primary database and starts `setupServer()` from `src/server.ts` on port 3000.

`src/server.ts` owns global composition:

- environment validation
- security and request middleware
- analytics and Prometheus metrics
- static/EJS hosting
- optional React SPA hosting when `SERVE_REACT=true`
- sessions and CSRF
- route mounting and global errors

Do not add feature endpoints directly to `server.ts`. Mount them through `src/routes/index.ts`.

## Route map

| Area | Files |
|---|---|
| Twitch login/callback/session auth | `src/routes/auth.routes.ts` |
| Public pages, health, statistics, leaderboard | `src/routes/public.routes.ts` |
| User dashboard/API | `src/routes/user/*.routes.ts` |
| Admin API and tools | `src/routes/admin/*.routes.ts` |
| Public developer API | `src/routes/api/developer.routes.ts` |
| Overlay tokens/config/data | `src/routes/overlay.routes.ts` |
| Header-auth internal backup | `src/routes/internal-backup.routes.ts` |

Route handlers should authenticate/authorize, validate input, call a service, and translate results to HTTP. Reuse middleware from `src/middleware/`; do not duplicate session-role or CSRF rules.

## React SPA

The current application UI is `frontend-react/` using React, Vite, React Router, TanStack Query, Axios, React Hook Form, and Zod.

| Path | Responsibility |
|---|---|
| `src/App.tsx` | route tree and layout selection |
| `src/AppProviders.tsx` | application-wide providers |
| `src/features/` | domain/page implementations |
| `src/api/` | backend HTTP clients |
| `src/types/` | shared frontend request/response shapes |
| `src/layouts/` | public, dashboard, and admin shells |
| `src/routes/ProtectedRoute.tsx` | user/admin route gating |
| `src/context/AuthProvider.tsx` | authenticated-user state |
| `src/components/` | reusable controls, feedback, layout, charts |

For a new screen:

1. Add or extend the backend route/service first.
2. Add types and an API wrapper in `frontend-react/src/types/` and `frontend-react/src/api/`.
3. Implement the domain UI in `frontend-react/src/features/`.
4. Register navigation/route changes in `App.tsx` and the appropriate layout.
5. Handle loading, empty, error, confirmation, and toast states using existing primitives.

## Backend/frontend contract

- Axios defaults and CSRF behavior live in `frontend-react/src/api/http.ts`; use them instead of raw fetches.
- Keep frontend and backend field names aligned. Search the request/response type, API wrapper, route, and service together.
- Backend paths in `REACT_BACKEND_PREFIXES` remain server-owned; all other GET/HEAD navigations may fall back to the SPA.
- Legacy `frontend/views` and `frontend/public` remain relevant for EJS, static assets, and non-SPA endpoints. Do not delete or migrate them incidentally.

## Verification

Backend route changes: targeted backend test plus `bun run build`.

React changes:

```bash
npm --prefix frontend-react run build
npm --prefix frontend-react run lint
```

For contract changes, verify both sides and the authenticated/unauthenticated error path.
