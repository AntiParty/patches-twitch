---
name: patches-twitch
description: Use when working anywhere in the patches-twitch repository, including Twitch chat commands, IRC or Helix, EventSub, OAuth and tokens, Express routes, the React dashboard, Sequelize models, background jobs, predictions, giveaways, overlays, analytics, security, tests, or deployment operations.
---

# patches-twitch repository guide

Use this skill as a map, not as a substitute for reading the code. Its purpose is to get to the correct files, boundaries, and tests quickly.

## Start every task

1. Run `git status --short` and preserve unrelated changes.
2. Read `package.json`, then classify the task with the table below.
3. Read the linked reference file completely before editing.
4. Inspect the target source, its callers, and the nearest tests. Source code wins if this map has drifted.
5. Keep changes inside the owning layer. Add or update the narrowest relevant test.

## Core boundaries

- The web process starts at `src/index.ts`; the bot process starts at `src/botService.ts`. They do not share runtime memory.
- Cross-process bot operations go through the authenticated Control API. Web callers use `src/util/botControl.ts`; bot endpoints live in `src/botService.ts`.
- Persistent state belongs in the appropriate Sequelize database. Do not invent an in-memory bridge between processes.
- Incoming chat uses raw IRC in `src/util/ircBot.ts`; outgoing chat uses Twitch Helix through `sendChatMessage`.
- Put reusable domain behavior in `src/services/` or a focused utility. Keep routes, commands, and process entrypoints thin.
- The production UI is the React app in `frontend-react/`; the legacy EJS/static tree in `frontend/` still serves backend-owned and fallback surfaces.

## Task router

| Task | Start here | Then read |
|---|---|---|
| Add or change `!command` | `src/commands/`, `src/handlers/commands.ts` | [references/bot-and-chat.md](references/bot-and-chat.md) |
| IRC parsing, reconnects, replies, shared chat | `src/util/ircBot.ts`, `src/util/chatReplyTargets.ts` | [references/bot-and-chat.md](references/bot-and-chat.md) |
| OAuth, scopes, token refresh, custom bots | `src/botManager.ts`, `src/util/twitchUtils.ts`, `src/util/botAuth.ts` | [references/bot-and-chat.md](references/bot-and-chat.md) |
| EventSub or channel-point redemptions | `src/util/twitchEventSubWs.ts`, `src/handlers/eventsubStatus.ts` | [references/bot-and-chat.md](references/bot-and-chat.md) |
| Web route or API | `src/routes/`, `src/server.ts` | [references/web-and-frontend.md](references/web-and-frontend.md) |
| React page, component, or API client | `frontend-react/src/` | [references/web-and-frontend.md](references/web-and-frontend.md) |
| Model, schema, session, or migration | `src/db.ts`, `src/dbMetrics.ts`, `src/dbSessions.ts`, `src/scripts/` | [references/data-and-jobs.md](references/data-and-jobs.md) |
| Cache, polling, token refresh, periodic work | `src/jobs/` | [references/data-and-jobs.md](references/data-and-jobs.md) |
| Predictions or prediction automation | `src/services/`, `src/models/predictionAutomation.ts` | [references/features-and-services.md](references/features-and-services.md) |
| Giveaways or channel-point rewards | `src/services/giveaway.service.ts`, `src/services/twitchChannelPoints.service.ts` | [references/features-and-services.md](references/features-and-services.md) |
| Rank, leaderboard, sessions, goals, overlays | matching command/service/route plus `src/jobs/streamSessionPoller.ts` | [references/features-and-services.md](references/features-and-services.md) |
| Auth, CSRF, roles, rate limits, secrets | `src/middleware/`, `src/config/`, relevant route | [references/testing-and-operations.md](references/testing-and-operations.md) |
| Metrics, health, admin operations, auditing | `src/services/operationsAnalytics.service.ts`, `src/dbMetrics.ts` | [references/testing-and-operations.md](references/testing-and-operations.md) |
| Unsure where a subsystem lives | repository entrypoints and directory map | [references/architecture.md](references/architecture.md) |

## Reference index

- [references/architecture.md](references/architecture.md): processes, data flow, directory ownership, and system-wide invariants.
- [references/bot-and-chat.md](references/bot-and-chat.md): BotManager, IRC/Helix, commands, Control API, EventSub, tokens, and chat safety.
- [references/web-and-frontend.md](references/web-and-frontend.md): Express composition, middleware, routes, React architecture, and backend/frontend coordination.
- [references/data-and-jobs.md](references/data-and-jobs.md): three SQLite databases, models, migrations, caches, and background jobs.
- [references/features-and-services.md](references/features-and-services.md): domain map for predictions, giveaways, ranked data, subscriptions, overlays, and operations.
- [references/testing-and-operations.md](references/testing-and-operations.md): test placement, verification commands, security, logging, metrics, and operational checks.

## Verification

Run the smallest relevant check first, then broaden:

| Change | Minimum verification |
|---|---|
| Backend TypeScript | `bun run build` and targeted unit test |
| Cross-process, DB, or route integration | relevant integration test, then `bun run test:integration` |
| React UI | `npm --prefix frontend-react run build` and `npm --prefix frontend-react run lint` |
| Pure documentation or skill change | validate links, paths, frontmatter, and representative retrieval tasks |

Do not claim completion from compilation alone. Exercise the changed behavior or its nearest automated test.

## Common mistakes

- Editing a generated/cache/runtime artifact instead of its producer.
- Calling the bot Control API without `x-bot-control-secret` from `botControlHeaders()`.
- Treating `Channel.username` as if it includes `#`; stored usernames are normalized.
- Sending chat directly over IRC instead of `sendChatMessage`.
- Adding business logic to `botService.ts`, `server.ts`, route handlers, or React API wrappers.
- Updating only a React screen or only an Express endpoint when their request/response contract changed.
- Using `sequelize.sync({ alter: true })` as a production migration strategy.
- Forgetting cleanup and concurrency guards in reconnect loops, timers, polling jobs, and token refresh.
