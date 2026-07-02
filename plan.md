# plan.md — FinalsRS React Frontend Migration Plan

## Goals

Migrate the current server-rendered EJS frontend into a modern React application while:

- Preserving every existing feature
- Keeping the current Express backend and JSON APIs
- Avoiding backend rewrites unless absolutely necessary
- Making the frontend maintainable, reusable, and scalable
- Supporting future games beyond THE FINALS

The backend should remain the source of truth. **This project is a frontend rewrite, not a backend rewrite.**

## Guiding Principles

**DO**

- Reuse every existing API endpoint whenever possible.
- Keep session authentication exactly as it works today.
- Preserve existing permissions and role gates.
- Convert pages incrementally into reusable React components.
- Keep the visual design almost identical.
- Remove duplicated HTML/CSS/JS.

**DON'T**

- Rewrite backend APIs.
- Break OBS overlays.
- Introduce unnecessary abstractions.
- Replace working APIs with new ones.
- Over-engineer state management.

## Recommended Stack

- React 19
- TypeScript
- Vite
- React Router
- TanStack Query
- Axios (or fetch wrapper)
- React Hook Form
- Zod
- Framer Motion (optional)
- Font Awesome
- CSS Variables
- **CSS Modules** (chosen styling approach)

## Decisions

- **Styling:** CSS Modules + CSS variables (port `_theme.ejs` tokens to `:root`).
- **Location:** `frontend-react/` inside this repo (monorepo-style; Express keeps serving APIs).
- **Backend port:** Express runs on `:3000`; Vite dev server proxies API/auth paths there so
  the session cookie stays same-origin in development.

## Proposed Folder Structure

```text
frontend-react/
src/
├── api/            api.ts auth.ts dashboard.ts leaderboard.ts overlay.ts admin.ts
├── components/     layout/ navigation/ cards/ buttons/ tables/ charts/ forms/ overlays/ modals/
├── features/       auth/ dashboard/ leaderboard/ statistics/ overlays/ admin/
├── hooks/
├── context/
├── layouts/
├── pages/
├── routes/
├── styles/
├── utils/
├── types/
└── App.tsx
```

## Phase 1 — Foundation

1. **Create React app** — Vite + TypeScript + React Router + TanStack Query. Do not migrate pages yet.
2. **Build API layer** — one centralized API client (`api.get("/api/...")`) that auto-includes
   credentials, injects CSRF, normalizes errors, supports interceptors. No component calls `fetch` directly.
3. **Authentication Context** — `AuthProvider` exposing current user, role, premium status, loading
   and login state. Loads from `GET /api/auth/status` (+ subscription status).
4. **CSRF Handling** — utility that fetches, caches and auto-injects the token on every POST/PUT/DELETE.
5. **Global Theme** — convert `_theme.ejs` into `:root` CSS variables. Do not change colors; preserve
   typography and spacing.

## Phase 2 — Layout System

Replace repeated EJS layouts with reusable React layouts: `<AppLayout>`, `<DashboardLayout>`,
`<AdminLayout>`, `<AuthLayout>`. Reusable pieces: Navbar, Sidebar, Footer, Header, Page title,
User avatar, Notification banner.

## Phase 3 — Shared Components

Before migrating pages, build reusable components: Buttons, Cards, Tables, Inputs, Dropdowns,
Dialogs, Tabs, Search bars, Badges, Stat cards, Loading spinner, Skeleton loader, Empty state,
Error state, Charts, Progress bars, Role badges, Premium badge.

## Phase 4 — Route Conversion

Convert one page at a time, fully complete before moving on:

1. Landing page
2. Login
3. Dashboard
4. Leaderboard
5. Statistics
6. Documentation
7. Subscribe
8. Settings
9. Admin
10. Remaining pages

### Dashboard Migration

The dashboard is the closest thing to an SPA. Convert each tab into its own React component:
Overview, Predictions, Overlay, Settings, Statistics, Subscription, Connections.

## Phase 5 — State Management

Local component state where possible. TanStack Query for server data, caching, mutations, refetching.
Avoid Redux unless future requirements justify it.

## Phase 6 — Forms

Replace manual DOM manipulation with React Hook Form + Zod validation. Every form becomes a typed
form component.

## Phase 7 — API Migration

Replace `fetch(...)` with feature service calls (e.g. `api.user.getSettings()`). Service files by
feature: `auth.ts`, `dashboard.ts`, `leaderboard.ts`, `overlay.ts`, `statistics.ts`, `admin.ts`.

## Phase 8 — Overlay Pages

OBS overlays stay lightweight. React acceptable, avoid heavy deps. Maintain identical URLs, identical
token system, polling/websocket behavior, transparent backgrounds, minimal bundle size. Performance
over architecture.

## Phase 9 — Admin

Isolated admin routes. Do not mix admin components into normal user pages. Reuse generic Tables,
Forms, Charts, Filters.

## Phase 10 — Polish

Remove duplicated CSS, extract shared hooks/utilities, improve accessibility, keyboard navigation,
mobile layouts, loading states, skeletons, error handling.

## Suggested React Routing

```text
/            Home
/login
/dashboard
/leaderboard
/statistics
/docs
/subscribe
/settings
/admin/*
```

Protected routes: Dashboard, Settings, Admin, Subscription.

## Component Hierarchy

```text
<App>
  AuthProvider
  QueryProvider
  Router
    Layout
      Navbar
      Sidebar
      Routes
        Dashboard (StatCards, PredictionList, OverlaySettings, UserSettings, Subscription)
        Leaderboard
        Statistics
        Docs
        Admin
```

## Data Flow

```text
Backend → JSON API → API Client → TanStack Query → React Components → User
```

## Performance Goals

- Route-level code splitting & lazy loading
- Component memoization where appropriate
- Cache API responses
- Minimize unnecessary re-renders
- Keep overlay bundles extremely small

## Definition of Done

- Every EJS page has an equivalent React route.
- Every existing API endpoint is reused.
- Authentication behaves identically; session cookies work unchanged; CSRF still functions.
- Admin features work. OBS overlays continue functioning.
- All duplicated HTML replaced with reusable React components.
- Styling matches the existing design system.
- No backend functionality lost.

## Nice-to-Have (Post-Migration)

Dark/light theme support, Storybook docs, better analytics dashboard, improved charts, better
responsive design, toast system, global error boundary, optimistic updates, shared UI library for
future game integrations.

## Migration Strategy

Work incrementally — no full rewrite in one pass. For each page: (1) analyze existing EJS/HTML + inline
JS, (2) identify all API calls/dependencies, (3) extract reusable UI into shared components, (4)
recreate in React preserving functionality + styling, (5) verify feature parity before deleting legacy,
(6) repeat. Backend APIs, auth, sessions, CSRF, and overlay endpoints stay stable throughout.
