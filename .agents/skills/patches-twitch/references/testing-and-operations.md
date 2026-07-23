# Testing and operations

## Test layout

- `src/tests/unit/`: pure validation, services with injected dependencies, middleware, commands, parsing, UI/document contracts.
- `src/tests/integration/`: Sequelize models, persistence, and multi-component workflows.
- `src/tests/setup.ts`: shared request/session factories and assertions.

Use the closest existing test as the pattern. Regression fixes need a test that fails for the original behavior before the fix.

## Commands

```bash
bun run build
bun run test:unit
bun run test:integration
bun run test
npm --prefix frontend-react run build
npm --prefix frontend-react run lint
```

The root TypeScript build excludes `frontend-react`; backend and frontend compilation are separate checks. Prefer a targeted Mocha file while iterating, then run the relevant suite.

## Security boundaries

| Concern | Owner |
|---|---|
| Startup secret validation | `src/config/envValidation.ts` |
| Sessions | `src/config/session.config.ts`, `src/dbSessions.ts` |
| Authentication/roles/subscription | `src/middleware/auth.middleware.ts`, `subscription.middleware.ts` |
| CSRF | `src/middleware/csrf.middleware.ts`, route composition in `server.ts` |
| Request blocking/rate limiting | `src/middleware/security.ts` |
| Request validation | `src/middleware/validation.middleware.ts` |
| OAuth state and token encryption | `src/util/crypto.ts`, auth routes, Twitch helpers |
| Bot Control API | `BOT_CONTROL_SECRET`, `src/util/botControl.ts`, `src/botService.ts` |
| Internal backup | header-auth route in `src/routes/internal-backup.routes.ts` |

Never weaken a middleware globally to make one endpoint work. Identify the route's intended trust boundary and add a narrow, tested rule.

## Logging, metrics, and audit

- Use `src/util/logger.ts`; include a stable `[module]` prefix and structured context where useful.
- Bot alerts and Discord warnings live in `src/util/botAlerts.ts`, `src/handlers/discordHandler.ts`, and related helpers.
- Chat ingress/egress rates: `src/util/messageRateTracker.ts`.
- Command usage: `src/util/commandAnalytics.ts`.
- Web analytics: `src/util/webAnalytics.ts`, `src/util/ignStats.ts`.
- Prometheus/web runtime metrics: `src/server.ts`.
- Operational and admin audit persistence: `src/services/operationalEvents.service.ts`, `src/dbMetrics.ts`.
- Admin health/overview aggregation: `src/services/operationsAnalytics.service.ts`.

Avoid double-counting events already recorded by IRC, middleware, or service wrappers.

## Operational checklist

For tokens, reconnects, jobs, DB writes, or cross-process work, verify:

1. What happens after process restart?
2. Can two refresh/poll/reconnect paths race?
3. Are timers, sockets, and in-memory guards cleaned up?
4. Is persisted state the source of truth?
5. Are secrets redacted from logs and responses?
6. Does partial failure isolate one channel/item or stop the whole batch?
7. Is the failure visible through logs, metrics, alerts, or operational events?

For user-facing changes, also verify anonymous, authenticated, unauthorized, empty, loading, and backend-error states as applicable.
