# Retention & UX pass — release notes

This patch addresses the 15 issues flagged in the UX audit plus a dashboard
visual overhaul. Grouped by the original audit issue numbers so we can track
what's shipped and what still needs a second pass.

## ✅ Shipped

### Silent-failure cluster (issues #1, #2, #3, #7, #12)

- **`src/util/botAlerts.ts`** — new module. Central debounced in-chat alerter,
  also mirrors to Discord. One cooldown per `(channel, key)` pair so a
  flapping bot doesn't spam the stream.
- **`src/util/ircBot.ts`** — auth-failure, reconnect-attempt-3, and
  reconnect-exhausted paths now post a plain-English message to the
  broadcaster's chat with a support link. Message-filter suppression also
  tells the streamer (rate-limited) so a "vanished response" doesn't look
  like a broken bot.
- **`src/jobs/botTokenRefresher.ts`** — refresh failures page Discord; partial
  reconnect failures after refresh notify just the affected channels.

### Dev mode (issue #3/#15)

- **`src/commands/devmode.ts`** rewritten — requires a second step
  (`!devmode confirm`) within 30s before toggling, includes an explicit
  `!devmode status` read command, and the on/off messages are louder and
  include an undo hint.
- Exports `getDevModeChannels()` so the dashboard can render the state.

### Bad error copy (issue #5)

- **`src/commands/peak.ts`**, **`src/commands/rank.ts`** — generic
  "something went wrong" replaced with actionable copy including Discord
  and docs links.

### Onboarding gap (issue #6)

- **`src/commands/peak.ts`** — "no player linked" branch now shows a concrete
  example and a docs link instead of bare `!link` syntax.

### Incomplete help (issue #13)

- **`src/commands/help.ts`** rewritten — dynamically discovers commands from
  disk, skips admin/internal ones, caches the list for 5 minutes. Supports
  `!help <command>` as a deep link into docs.

### Banned page (issue #4)

- **`frontend/views/banned.ejs`** fully rewritten — appeal form that posts
  to `/api/appeal` (TODO: add the route), support email/Discord links, new
  visual language, CSRF-aware. No more dead-end.

### Auth + maintenance pages (issues #10, #14)

- **`frontend/views/system-message.ejs`** — new reusable status page template
  (takes `tone`, `badge`, `heading`, `body`, `details`, `actions`).
- **`src/routes/auth.routes.ts`** — OAuth catch now renders `system-message`
  with retry + support actions and the error detail instead of bare
  "Authentication failed" text.
- **`src/routes/user/dashboard.routes.ts`** — dashboard-disabled path renders
  `system-message` in maintenance tone instead of the auth template.

### Dashboard visual overhaul (the "vibecoded" feeling)

- **`frontend/views/user-dashboard.ejs`** — new `:root` token system
  (deeper surfaces, calmer violet, richer status colors, consistent radii
  8/12/16/20, motion tokens, shadow scale). Atmospheric radial-gradient
  background. Sidebar nav gets an accent rail + gradient on active state.
  Cards use layered gradient surfaces with hover affordance. Buttons have
  stronger brand shadows, keyboard focus rings, press-down animation.
- **Bot Health widget** added to the top of the Overview view. Calls
  `GET /api/bot/health`, auto-refreshes every 30s, and includes a
  user-initiated Reconnect button (`POST /api/bot/reconnect`). Status
  classes `.ok/.warn/.err/.devmode` drive colour coding.
- **`src/routes/user/dashboard.routes.ts`** — new `/api/bot/health` and
  `/api/bot/reconnect` endpoints behind `requireUserAPI` (+ CSRF on the
  POST). Proxies the existing Control API and derives token TTL from the DB.

## ⚠️ Partial / needs follow-up

### Subscribe page (issues #8, #9, #11)

Not yet touched in this pass. Next iteration should:
- Rewrite the custom-bot section of `subscribe.ejs` to explain the
  infra/branding value (keep paywall, justify it).
- Add a clearer error reason on the "Refresh Status" button when it fails.
- Clean up the custom-bot OAuth "refresh your dashboard to activate"
  ambiguity in `src/routes/auth.routes.ts` lines 130–212 by showing an
  explicit success/partial/failure state in the popup before it closes.

### Dashboard partial-ization

Visual tokens and the new widget are in, but the 4,170-line file is still
monolithic. Recommended phase-2: extract `frontend/views/partials/` for
`sidebar.ejs`, `onboarding-checklist.ejs`, and per-view sections so the file
is navigable.

### `/api/appeal` route

The new `banned.ejs` submits to `/api/appeal`. That route doesn't exist yet.
Either wire it up to the Discord webhook or an admin table. Until it ships,
the form will show an error and fall back to the mailto link (which still
works).

### Bot Health widget — richer data

`/api/bot/health` currently returns DB-derived token TTL and a proxy of the
Control API's `/health`. It does **not yet** expose per-channel dev-mode
state or last filter suppression. To finish:
- In `botService.ts`, extend the Control API's `/health` to accept
  `?channel=<name>` and include `devMode` (from `getDevModeChannels()`) and
  `lastFilterSuppressionAt` (from a small in-memory ring buffer in
  `botAlerts.ts` or `messageFilter.ts`).
- Update the widget's consumer code to display those two fields — the
  markup and placeholders are already in place.

## Files touched

```
src/util/botAlerts.ts                 (new)
src/util/ircBot.ts                    (alerts + filter notices)
src/jobs/botTokenRefresher.ts         (refresh-fail Discord + partial-reconnect alerts)
src/commands/devmode.ts               (confirm flow + status subcommand)
src/commands/help.ts                  (dynamic discovery)
src/commands/peak.ts                  (better errors + onboarding hint)
src/commands/rank.ts                  (better errors)
src/routes/auth.routes.ts             (system-message on OAuth failure)
src/routes/user/dashboard.routes.ts   (system-message + /api/bot/health + /api/bot/reconnect)
frontend/views/banned.ejs             (full rewrite: appeal form)
frontend/views/system-message.ejs     (new reusable status template)
frontend/views/user-dashboard.ejs     (new tokens, nav/card/btn overhaul, Bot Health widget)
RELEASE-NOTES-retention-pass.md       (this file)
```

## Before merging

- `bun run build` — catch any type errors from the new imports.
- `bun run test:unit` and `bun run test:integration`.
- Manual: trigger a fake reconnect-exhausted (lower `MAX_RECONNECT_ATTEMPTS`
  to 2 in dev) and confirm the in-chat message + Discord warning both fire
  and are deduped on the next attempt.
- Manual: load `/dashboard` and confirm Bot Health widget shows live state,
  Refresh works, Reconnect works.
- Manual: hit an obviously-broken `/auth/callback?code=bad` and confirm the
  new `system-message` page renders.
- Manual: visit `/banned` (forcing the flag in dev) and submit a test appeal.
