# FinalsRS — React Frontend

React port of the FinalsRS web frontend. Reuses the existing Express backend and its JSON
APIs unchanged (see [`../plan.md`](../plan.md) and [`../FRONTEND_OVERVIEW.md`](../FRONTEND_OVERVIEW.md)).

## Stack

React 19 · TypeScript · Vite · React Router · TanStack Query · Axios · React Hook Form · Zod.
Styling: CSS Modules + CSS variables (design tokens ported from the legacy `_theme.ejs`).

## Running in development

The backend must be running on **http://localhost:3000** (the repo root: `bun run dev:server`).
Vite proxies API/auth/admin paths there so the session cookie + CSRF behave exactly as in
production.

```bash
npm install      # first time only
npm run dev      # http://localhost:5173
```

## Scripts

- `npm run dev` — Vite dev server with backend proxy.
- `npm run build` — type-check (`tsc -b`) + production build to `dist/`.
- `npm run preview` — preview the production build.
- `npm run lint` — oxlint.

## Architecture (Phase 1 foundation)

```
src/
├── api/         http.ts (axios client), api.ts (wrapper), errors.ts, auth.ts (+ feature services)
├── context/     auth-context.ts, AuthProvider.tsx
├── hooks/       useAuth.ts
├── routes/      ProtectedRoute.tsx
├── pages/       Home.tsx, NotFound.tsx (placeholders until Phase 4)
├── styles/      theme.css (tokens), global.css (base components)
├── types/       auth.ts
├── AppProviders.tsx   # QueryClient + Auth
└── App.tsx            # router
```

### Conventions

- **Never call `fetch` directly.** Use `api`/`http` from `@/api/api`, or a feature service.
- **CSRF** is injected automatically on POST/PUT/DELETE and retried once on rejection.
- **Auth state** comes from `useAuth()`; the backend stays the real authority.
- Import via the `@/` alias (e.g. `import { useAuth } from '@/hooks/useAuth'`).

Migration proceeds page-by-page per `../plan.md` (Phase 4). The legacy EJS frontend remains the
production frontend until each page reaches parity.
