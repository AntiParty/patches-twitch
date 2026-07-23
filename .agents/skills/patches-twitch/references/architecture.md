# Architecture

## Runtime topology

`patches-twitch` is a Bun/TypeScript application with two long-running backend processes and a separately built React SPA.

| Runtime | Entrypoint | Responsibility |
|---|---|---|
| Web | `src/index.ts` -> `src/server.ts` | Express pages/APIs, sessions, auth, admin surfaces, metrics, static assets, React SPA hosting |
| Bot | `src/botService.ts` | Per-channel bots, IRC sockets, EventSub subscriptions, token jobs, bot-only Control API |
| React build | `frontend-react/src/main.tsx` -> `App.tsx` | Public pages, user dashboard, admin UI, overlays |

The backend processes share SQLite data but not memory. The web process requests bot-memory operations through the local Control API at `BOT_CONTROL_URL` (default `http://127.0.0.1:4000`) using `BOT_CONTROL_SECRET`.

## High-level flows

**Incoming chat**

`Twitch IRC -> src/util/ircBot.ts -> loaded command -> src/commands/*.ts -> service/DB/cache -> ctx.say -> sendChatMessage -> Twitch Helix`

**Dashboard action**

`React feature -> frontend-react/src/api/*.ts -> Express route -> service/DB`

If the action must touch bot-process memory:

`Express route -> src/util/botControl.ts -> authenticated Control API -> botManager/IRC/EventSub`

**Background work**

`process startup -> src/jobs/*.ts -> service/Twitch/cache/DB -> logs and operational events`

## Directory ownership

| Path | Owns |
|---|---|
| `src/commands/` | Twitch command adapters |
| `src/handlers/` | command discovery and external event handlers |
| `src/services/` | reusable domain operations |
| `src/util/` | infrastructure clients, parsing, auth, crypto, logging |
| `src/jobs/` | scheduled/polling orchestration |
| `src/routes/` | Express HTTP adapters |
| `src/middleware/` | authentication, authorization, CSRF, validation, security |
| `src/models/` | domain types and pure validation separate from Sequelize |
| `src/scripts/` | manual migrations, recomputation, and diagnostic scripts |
| `src/tests/unit/` | pure behavior and isolated adapters |
| `src/tests/integration/` | DB and multi-component behavior |
| `frontend-react/src/features/` | page/domain UI |
| `frontend-react/src/api/` | typed backend clients |
| `frontend-react/src/components/` | reusable UI primitives |
| `frontend/` | legacy EJS views and public/static files |
| `docs/` | user and operator documentation |

## Design rules

- Follow an existing feature vertically: UI -> API client -> route -> service -> model/infrastructure -> test.
- Keep process entrypoints as wiring. Extract reusable behavior rather than expanding `botService.ts` or `server.ts`.
- Search for both `@/module` and relative imports before moving or renaming backend code.
- Treat `cache/`, `data/`, `logs/`, `stats.json`, build output, and uploaded files as runtime artifacts unless the task explicitly targets them.
- Check recent commits and adjacent tests; this repository evolves faster than prose maps.
