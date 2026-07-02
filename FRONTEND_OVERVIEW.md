# FinalsRS Frontend — Architecture & Inventory

> Purpose of this document: a complete description of the **current frontend** of the
> `patches-twitch` (FinalsRS) project so it can be handed to an LLM to author a prompt
> for **porting the frontend to React**. It covers the tech stack, how pages are served,
> the design system, every page/view, all the HTTP/JSON endpoints the frontend consumes,
> the auth/session model, the OBS overlays, and porting considerations.

---

## 1. High-level summary

FinalsRS is a Twitch bot + web dashboard for **THE FINALS** ranked stats. The web side is a
**server-rendered, multi-page app** with **no frontend build step and no frontend framework**.

- **Server:** Node/Bun + **Express 4**, run via `bun`/TypeScript (`src/server.ts`).
- **View engine:** **EJS** (`app.set("view engine", "ejs")`), views in `frontend/views/`.
- **Static assets:** served from `frontend/public/` via `express.static`.
- **Client JS:** **vanilla JavaScript** inline in `<script>` tags inside views, plus a few
  shared files in `frontend/public/js/`. No bundler, no npm frontend deps, no TypeScript on
  the client. UI uses **Font Awesome** + Google Fonts (Inter / IBM Plex Sans / Archivo /
  JetBrains Mono) loaded from CDNs.
- **Styling:** Plain CSS. A shared design-token theme lives in an EJS partial
  (`frontend/views/partials/_theme.ejs`); some pages also pull `frontend/public/css/*.css`.
  Most pages have a large inline `<style>` block.
- **Data flow:** Pages are rendered server-side (sometimes with EJS-injected initial data),
  then client JS calls JSON API endpoints (`fetch`) to load/save dynamic data.
- **Auth:** Twitch OAuth → Express session cookie. CSRF tokens via `csurf` for state-changing
  requests. Role-based gating (Basic user / subscriber / tester / Staff / admin).

### What "porting to React" means here
There is **no SPA today** — it's many independent HTML/EJS documents. The closest thing to an
app is `user-dashboard.ejs`, a single page with client-side tab switching. A React port would
likely become a SPA (or Next.js app) that:
1. Keeps the **same JSON API** (the Express endpoints below) as the backend.
2. Recreates each page/view as a React route/component.
3. Replaces inline vanilla-JS `fetch` handlers with React data fetching + state.
4. Re-implements the design tokens as CSS variables / a theme.

---

## 2. How the frontend is served (Express)

Entry: `src/server.ts` → `setupServer()`.

- `viewsPath = frontend/views`, `publicPath = frontend/public`.
- Middleware order: security (block suspicious + IP rate limit) → request logging →
  web analytics tracking (skips `/admin`) → body parsers → `express.static(public)` →
  `express-session` → CSRF (with exemptions) → expose `res.locals.csrfToken` → routes →
  global error handler (returns JSON 500; special-cases `EBADCSRFTOKEN` → 403 JSON).
- Routes are aggregated in `src/routes/index.ts`:
  | Mount | File | Purpose |
  |---|---|---|
  | `/` | `auth.routes.ts` | Twitch OAuth login/callback |
  | `/` | `public.routes.ts` | Landing, docs, leaderboard, public APIs, health |
  | `/` | `user/` | User dashboard + user JSON APIs |
  | `/` | `api/developer.routes.ts` | Public Developer API (v1) |
  | `/admin` | `admin/` | Admin panel + admin APIs |
  | `/` | `overlay.routes.ts` | OBS overlay data/config/token APIs |
  | `/internal` | `internal-backup.routes.ts` | service-to-service (not UI) |

Pages are returned either with `res.render("<view>", data)` (EJS) or
`res.sendFile(.../<page>.html)` (static HTML files that live under `views/`).

---

## 3. Auth / session / CSRF model

Defined in `src/middleware/auth.middleware.ts`, `csrf.middleware.ts`, `subscription.middleware.ts`.

- **Login:** `GET /login` → redirect to Twitch OAuth → `GET /callback` exchanges code,
  fetches Twitch user, creates/updates `Channel`, sets session, redirects to `/dashboard`.
  `GET /reauth` re-runs OAuth with elevated scopes. `GET /api/auth/status` returns
  `{ isAuthenticated, ... }` (used by the landing page to swap "Login" → "Dashboard").
- **Session:** `express-session` backed by Sequelize store. Session holds
  `twitchUsername`, `channelId`, `role`, `isAdmin`, etc.
- **Guards (page):** `requireUser`, `requireAdmin`, `requireStaff`, `requireAnalyst`,
  `requireSubscription` → redirect/render if not allowed.
- **Guards (API, JSON 401/403):** `requireUserAPI`, `requireAdminAPI`, `requireStaffAPI`,
  `requireAnalystAPI`, `requireSubscriptionAPI`.
- **API key:** `requireApiKey` for some machine endpoints (`/users`).
- **Roles:** `Basic user`, `subscriber`, `tester`, `Staff`, `admin`. Premium "bypass" roles:
  `subscriber`, `tester`, `Staff`, `admin`. Premium status = Twitch sub **or** bypass role.
- **CSRF:** `csurf` (cookie:false → token tied to session). Token is injected into pages two ways:
  - EJS local `csrfToken` (e.g. dashboard, statistics, subscribe), and
  - `<meta name="csrf-token" content="...">` in the dashboard.
  Client reads it via `document.querySelector('meta[name="csrf-token"]')` and sends it as the
  `CSRF-Token` (a.k.a. `X-CSRF-Token`) header on POST/PUT/DELETE. CSRF is **skipped** for
  `/health`, token-based overlay endpoints (`/api/overlay/data/*`, `/api/overlay/config/*`),
  and `/admin/db`.

**Porting note:** A React SPA would need to keep the session cookie (same-origin fetch with
`credentials: 'include'`) and fetch a CSRF token from an endpoint (there's already
`GET /api/subscription/csrf-token`) or have the backend expose one for the SPA shell.

---

## 4. Design system (the visual language to preserve)

Single source of truth: **`frontend/views/partials/_theme.ejs`** (included by EJS pages via
`<%- include('partials/_theme') %>`). Static `.html` pages don't include it and instead repeat
styles inline or use `css/styles.css`.

**Design tokens (CSS custom properties on `:root`):**
- Surfaces: `--bg-app:#0b0b10`, `--bg-sidebar:#0f0f15`, `--bg-card:#15151c`, `--bg-card-2:#1a1a22`,
  `--bg-hover:#20202a`, `--bg-input:#0f0f15`, `--bg-overlay:rgba(8,8,12,.72)`.
- Borders: `--border:#23232c`, `--border-strong:#33333f`.
- Brand: `--primary:#a37bff`, `--primary-hover:#8e62ff`, `--primary-soft`, `--primary-ring`,
  `--brand-grad: linear-gradient(135deg,#b48bff,#7c5cff)`. Twitch purple `--twitch:#9147ff`.
- Text: `--text-main:#f2f2f5`, `--text-muted:#a2a2ad`, `--text-subtle:#70707a`.
- Status: `--success:#3dd598`, `--danger:#ff5a57`, `--warning:#f5a524`, `--info:#5aa7ff` (+ `-soft`).
- Shape/motion: radius scale `--radius-sm..xl` (8→20px), shadow scale, `--ease: cubic-bezier(.2,.7,.2,1)`.
- Fonts: `--font:"Inter"`, `--font-mono:"JetBrains Mono"`.

**Shared components defined in the theme:** `.fx-bg` (fixed radial-gradient atmospheric glow),
`.btn` / `.btn-primary` / `.btn-ghost` / `.btn-sm` / `.btn-lg`, `.card`, `.badge`, `.topnav`
(+ `.topnav-brand`, `.topnav-links`), `.chat-stage` / `.chat-msg` / `.chat-user`
(viewer/mod/bot variants — used to mock chat output on marketing pages), and section headings
(`.section-eyebrow`, `.section-title`, `.section-lede`).

**Aesthetic:** dark theme, purple (Twitch-adjacent) brand, glassy blurred nav, gradient text,
card-based layouts, Font Awesome icons. The dashboard uses **Archivo / IBM Plex Sans** instead
of Inter (separate font import in that view).

**Porting note:** Convert tokens into a single theme (CSS variables, Tailwind config, or a JS
theme object). The two font systems (`_theme.ejs` Inter vs dashboard Plex/Archivo) should be
reconciled.

---

## 5. Page / view inventory

Files in `frontend/views/`. `.ejs` = server-rendered with data; `.html` = static file sent via
`sendFile`; `.md` = raw markdown returned as a file.

| Route(s) | File | Type | Auth | Purpose / notes |
|---|---|---|---|---|
| `GET /` | `index.html` | static | public | **Landing/marketing page.** SEO meta + OG tags, GTM, hero, feature sections, mocked chat output. Loads `/css/styles.css` + `/js/script.js`. (Has a server check for an A/B variant.) |
| `GET /dashboard` | `user-dashboard.ejs` | EJS | `requireUser` | **The main app.** ~6000 lines; tabbed SPA-like UI (see §6). Receives `userStats`, `subscription`, `customBot`, premium flags, `csrfToken`. Falls back to `auth.ejs` if dashboard disabled. |
| `GET /login`, `/reauth`, `/callback`, `/api/auth/status` | `auth.routes.ts` | — | public | Twitch OAuth flow; no dedicated page except errors. |
| (login-disabled / message) | `auth.ejs` | EJS | — | Generic auth/message screen (title, message, logo, usernames). |
| `GET /banned` | `banned.ejs` | EJS | — | "You are banned" page; takes `reason`. |
| `GET /subscribe` | `subscribe.ejs` | EJS | `requireUser` | Premium subscription pitch / purchase entry. Uses `css/subscribe.css`. |
| `GET /subscription/manage` | `subscription-manage` (view) | EJS | `requireUser`+`requireSubscription` | Manage existing subscription. |
| `GET /statistics` (+ `/analyst` redirect) | `statistics-dashboard.ejs` | EJS | login-gated (`/statistics/login`) | **Internal web-analytics dashboard** (traffic, commands, IGN experiment, referrals, charts). Polls `/api/statistics`. |
| `GET /leaderboard` | `leaderboard.html` | static | public | THE FINALS leaderboard; fetches `/api/leaderboard?mode=`. |
| `GET /docs` | `docs.html` | static | public | Command/usage documentation (marketing-styled). |
| `GET /developer` | `developer-api.html` | static | public | Public Developer API docs (v1). |
| `GET /twitch-drops` (+ `/drops` redirect) | `drops.html` | static | public | THE FINALS Twitch drops info page. |
| `GET /legal` | `legal.html` | static | public | Legal hub; loads `/js/legal.js`. |
| `GET /privacy.md`, `/terms.md` | `privacy.md`, `terms.md` | markdown | public | Raw markdown policy docs (also `/docs-markdown`). |
| `GET /analytics-dashboard` | `analytics-dashboard.html` | static | (internal) | Alternate analytics view. |
| `GET /botmetrics` (+ `/botmetrics/login`) | `botmetrics.ejs` | EJS | password-gated | Bot/runtime metrics dashboard (Prometheus-derived); polls `/api/internal/metrics`. |
| `GET /admin` | `admin-dashboard.html` | static | `requireAdmin` | **Admin panel** (channels, messaging, drops, operations). Talks to `/admin/*` APIs. |
| `system-message.ejs` | — | EJS | — | Generic full-page status/message screen (reusable). |

Markdown files `privacy.md` / `terms.md` live in `views/` but are returned as files.

---

## 6. The User Dashboard (`user-dashboard.ejs`) — the core of the port

This is the most important file. It is a **single HTML document acting as a tab-based SPA**.
Structure: `<head>` (fonts, CSRF meta, early `switchView` definition) → inline `<style>`
(~lines 54–1936) → `<aside class="sidebar">` nav → main content with multiple
`<div id="view-*" class="view-section">` panels → a large inline `<script>` (~lines 3763–6061) →
`<script src="/js/feedback.js">`.

**Navigation / views** (sidebar `.nav-item[data-view]`, toggled by `switchView(viewId)` which
adds `.active` and lazy-loads data):

| View id | Sidebar label | What it does |
|---|---|---|
| `overview` | Overview | Status strip, onboarding checklist, account/bot status. Default active. |
| `commands` | Commands | List/edit/reset chat commands (`/api/my-commands`). Variable insertion helper. |
| `predictions` | Predictions | Twitch Predictions: presets CRUD, start/resolve/cancel, and **automation** (premium). |
| `rank-tracker` | Rank Tracker | Set/track THE FINALS rank goal; shows current rank, Ruby status. |
| `overlays` | Overlays | Configure OBS overlay (theme, color, visibility toggles), copy URL, regenerate token, reset session. |
| `subscription` | Custom Bot / Premium | Premium status, custom-bot linking, setup guide. |
| `settings` | Settings | Account settings, link THE FINALS player ID, disconnect/toggle bot. |
| (link) | Docs | opens `/docs` in new tab. |
| Onboarding modal | — | Multi-step "getting started" wizard + checklist. |

**Client JS responsibilities (all vanilla, in the inline script):**
- **View switching & onboarding:** `switchView`, `openGettingStarted`/`nextStep`/`previousStep`/
  `updateOnboardingStep`/`finishGettingStarted`, `checkOnboardingProgress`, `updateStepStatus`,
  `showOnboardingChecklist`/`hideOnboardingChecklist`, `goToStepAction`.
- **UX helpers:** `showToast(message,type)`, `showConfirm(title,body)` (promise-based modal),
  `getCsrfHeaders()` (reads CSRF meta).
- **Commands:** `fetchCommands`, `saveCommand`, `resetCommand`, `updatePreview`,
  `updateVariables`, `insertVariable`.
- **Rank tracker:** `loadRankGoal`, `updateRankGoal`, `deleteRankGoal`, `fetchCurrentRank`,
  `refreshCurrentRank`, `updateRankDisplay`, `fetchRubyObject`/`checkRubyStatus`,
  `getSelectedTargetRank`, `getNextRankMilestone`, number formatters.
- **Overlays:** `loadOverlayToken`/`loadOverlayConfig`, `saveOverlayConfig`,
  `regenerateOverlayToken`, `resetSession`, `updateOverlayUrlDisplay`/`copyOverlayUrl`,
  `updateOverlayPreview`.
- **Predictions:** `loadPredictions`, `renderPredictionPresets`, `savePredictionPreset`,
  `editPredictionPreset`, `deletePredictionPreset`, `selectPredictionPreset`,
  `startPredictionFromSelectedPreset`, `resolvePrediction`, `cancelPrediction`, outcome-row
  helpers, and automation: `renderPredictionAutomation*`, `savePredictionAutomation`,
  `startPredictionAutomationNow`, `cancelPredictionAutomation`, `applyPredictionAutomationMode`,
  `setPredictionAuthStatus`.
- **Account/bot:** link account, disconnect bot, `toggleBot`, target-rank change listener.

**Patterns to note for the port:** lots of `document.getElementById(...).textContent = ...`,
manual `classList.toggle`, `fetch` + `try/catch` + toast. All of this becomes React state +
components. The CSRF header pattern and `credentials` (same-origin cookie) must be preserved.

---

## 7. JSON API endpoints consumed by the frontend

These are the contract the React app must call. Grouped by area. (Method, path, auth, purpose.)

### Auth / session
- `GET /api/auth/status` — public — `{ isAuthenticated }` for landing page.

### Dashboard – account & bot (`user/dashboard.routes.ts`)
- `POST /api/link-account` — user+CSRF — link THE FINALS `playerId`.
- `POST /api/disconnect-bot` — user+CSRF — remove channel / EventSub subs.
- `POST /api/toggle-bot` — user+CSRF — enable/disable bot for channel.

### Commands (`user/commands.routes.ts`)
- `GET /api/my-commands` — user — list user's commands + responses.
- `POST /api/my-commands` — user — save/reset a command.

### Rank goal & current rank (`user/rankgoal.routes.ts`, `public.routes.ts`)
- `GET /api/my-rank-goal` — user — current goal.
- `POST /api/my-rank-goal` — user — set goal.
- `DELETE /api/my-rank-goal` — user — clear goal.
- `GET /api/my-current-rank` — user — live rank/RS.
- `GET /api/ruby-status` — used for Ruby (top-500) achievement state.

### Overlays (`overlay.routes.ts`)
- `GET /api/overlay/token` — user — get this user's overlay token.
- `POST /api/overlay/regenerate-token` — user+rate-limit — new token.
- `GET /api/overlay/:username/token`, `POST /api/overlay/:username/regenerate-token` — by username.
- `GET /api/overlay/data/:token` — **public, token-auth, CSRF-exempt** — live overlay stats
  (player name, league, RS, session delta, goal). Polled by OBS overlays.
- `GET /api/overlay/config/:token` — **public, token-auth, CSRF-exempt** — overlay appearance
  (`theme`, `primaryColor`, layout/visibility). Polled by OBS overlays.
- `POST /api/overlay/config` — user — save appearance/visibility.
- `POST /api/overlay/reset-session` — user — reset session start RS / clear cache.

### Predictions (`user/predictions.routes.ts`)
- Presets: `GET/POST /api/user/prediction-presets`, `PUT/DELETE /api/user/prediction-presets/:alias`.
- Live: `GET /api/user/predictions/status`, `GET /api/user/predictions/current`,
  `POST /api/user/predictions/start`, `POST .../resolve`, `POST .../cancel`.
- Automation (premium / subscription-gated): `GET/PUT /api/user/predictions/automation`,
  `POST /api/user/predictions/automation/start`, `POST .../automation/cancel`.

### Subscription / custom bot (`user/subscription.routes.ts`)
- `GET /api/subscription/status`, `GET /api/subscription/check`,
  `POST /api/subscription/refresh`, `GET /api/subscription/custom-bot-auth-url`,
  `POST /api/subscription/unlink-bot`, `GET /api/subscription/csrf-token`.

### Analytics (user-facing) (`user/analytics.routes.ts`)
- `GET /api/my-analytics`, `GET /api/my-analytics/summary` — per-channel analytics.

### Public / misc (`public.routes.ts`)
- `GET /api/statistics` — internal web-analytics dashboard data.
- `GET /api/leaderboard?mode=` — THE FINALS leaderboard.
- `GET /api/analytics`, `GET /api/ign-stats`, `GET /api/rs-prediction`,
  `GET /api/active-streamers`.
- `POST /api/feedback` — rate-limited — feedback widget (also posts to a Discord webhook).
- `GET /api/internal/metrics` — botmetrics page (password-gated).
- `GET /stats.json`, `GET /force-stats`, `GET /health`, `GET /users` (API key).

### Admin (`admin/*`) and Developer (`api/developer.routes.ts`)
- `/admin/*` JSON endpoints back `admin-dashboard.html` (channels, messaging, drops, operations).
- Developer API v1 (public, documented on `/developer`).

---

## 8. OBS Overlays (`frontend/public/overlays/*.html`)

Standalone single-file HTML pages designed as **OBS "browser source"** widgets. They are **not**
part of the dashboard SPA and arguably stay as static pages (or become a separate lightweight
React render target). Each is a self-contained theme.

- Files: `overlay.html` (full/legacy), `minimal.html`, `dark.html`, `dark-slim.html`,
  `glass.html`, `neon.html`, `card.html`, `rank-focus.html`, `terminal.html`.
- **How they work:**
  - Token read from URL: `const TOKEN = new URLSearchParams(location.search).get('token')`.
  - Poll **config** (`GET /api/overlay/config/${TOKEN}`) and **data**
    (`GET /api/overlay/data/${TOKEN}`) on `setInterval` (data ~5–10s, config ~10–20s).
  - Render player name, rank icon, league text, RS (with `animateNumber` count-up easing),
    session delta. `applyVisibility()` / `updateLayout()` hide/show fields per config.
  - No auth cookie/CSRF — token in the URL is the only credential (endpoints are CSRF-exempt).
- **Porting note:** These can remain plain HTML, or be reimplemented as a small React overlay
  app keyed by `?token=`. Keep them dependency-light and transparent-background for OBS.

---

## 9. Static assets (`frontend/public/`)

- `css/styles.css` (1077 lines) — landing page (`index.html`) styles.
- `css/subscribe.css` (436) — subscribe page.
- `css/feedback.css` (170) — floating feedback widget.
- `js/script.js` (54) — landing page: scroll-reveal `IntersectionObserver`, mobile menu toggle,
  `checkLoginStatus()` → `updateAuthUI()` (swap Login→Dashboard).
- `js/feedback.js` (123) — **self-injecting feedback widget** (button + modal), used on multiple
  pages (e.g. dashboard `<script src="/js/feedback.js">`); injects its own CSS, posts to
  `POST /api/feedback`. Guards against double-init via `window.feedbackSystemInitialized`.
- `js/legal.js` (69) — legal page interactions.
- `assets/` — `logo.png`, `finalsrr-chat-preview.png` (OG image).
- `blog.json`, `robots.txt`, `sitemap.xml`.

---

## 10. Porting considerations / recommendations (for the React prompt)

1. **Keep the Express JSON API as-is**; build React as a separate frontend that calls the same
   endpoints with `credentials: 'include'`. The auth model is cookie-session + CSRF header.
2. **Routing:** map pages to routes — `/` (landing), `/dashboard` (the SPA; the heaviest port),
   `/leaderboard`, `/docs`, `/developer`, `/twitch-drops`, `/legal`, `/subscribe`,
   `/statistics`, `/admin`, plus auth flow pages. Overlays are a separate concern.
3. **Dashboard:** the 7 tab views become routed/nested components: Overview, Commands,
   Predictions (with Automation), Rank Tracker, Overlays, Subscription/Custom Bot, Settings —
   plus the onboarding wizard/checklist and the toast/confirm primitives.
4. **Design system:** port the `_theme.ejs` tokens to CSS variables (or Tailwind/CSS-in-JS).
   Reconcile the two font stacks. Recreate `.btn`, `.card`, `.badge`, `.topnav`, `.chat-stage`.
5. **Cross-cutting widgets:** feedback button/modal (currently `feedback.js`) → a React
   `<FeedbackWidget>`; toast + confirm dialog → shared providers/hooks.
6. **CSRF:** fetch a token (e.g. `GET /api/subscription/csrf-token` or a new shell endpoint) and
   send it as `CSRF-Token` on all mutating requests; keep CSRF-exempt overlay endpoints as-is.
7. **Overlays:** likely remain standalone (transparent bg, token-in-URL polling). Optional to
   port to React, but they must stay lightweight and OBS-friendly.
8. **SEO/marketing pages** (landing, docs, drops, developer): if React, consider SSR/Next.js to
   keep the existing OG/meta and GTM (`index.html` includes Google Tag Manager).
9. **No existing client tests / build** — the React app introduces the first frontend build
   pipeline; the current code has zero frontend tooling to migrate.

---

## 11. File map (quick reference)

```
frontend/
  views/
    index.html                 # landing (static)
    user-dashboard.ejs         # MAIN tabbed dashboard (~6000 lines) ← core port
    auth.ejs                   # auth/message screen
    banned.ejs                 # ban screen
    subscribe.ejs              # premium pitch
    statistics-dashboard.ejs   # internal web analytics
    botmetrics.ejs             # bot/runtime metrics (password-gated)
    leaderboard.html           # public leaderboard
    docs.html                  # command docs
    developer-api.html         # public dev API docs
    drops.html                 # twitch drops
    legal.html / privacy.md / terms.md
    analytics-dashboard.html   # alt analytics
    admin-dashboard.html       # admin panel
    system-message.ejs         # generic status page
    partials/_theme.ejs        # DESIGN TOKENS + base components (EJS pages)
  public/
    css/   styles.css subscribe.css feedback.css
    js/    script.js feedback.js legal.js
    overlays/  overlay.html minimal.html dark.html dark-slim.html glass.html
               neon.html card.html rank-focus.html terminal.html   # OBS sources
    assets/ logo.png finalsrr-chat-preview.png
    blog.json robots.txt sitemap.xml

src/
  server.ts                    # Express setup, EJS, static, middleware order
  routes/                      # all endpoints (see §2 and §7)
  middleware/                  # auth / csrf / subscription / security / validation
```
