# Data and background jobs

## Databases

The repository uses three Sequelize-backed SQLite files:

| Database | Module | Contents |
|---|---|---|
| `data/accounts.sqlite` | `src/db.ts` | channels, tokens, responses, ranked sessions/goals, predictions, subscriptions, custom bots, peaks, giveaways |
| `data/metrics.sqlite` | `src/dbMetrics.ts` | request/performance analytics, IGN/referral data, operational events, admin audit events |
| `data/sessions.sqlite` | `src/dbSessions.ts` plus `src/config/session.config.ts` | Express session storage |

Important identifiers:

- `Channel.username` is the normalized internal/IRC key without `#`.
- `Channel.twitch_user_id` is the Twitch broadcaster/user identifier.
- Tokens stored on channels or custom bot accounts may be encrypted; use existing access helpers.

## Primary models

`src/db.ts` contains the Sequelize definitions and exports for:

- `Channel`, `CustomResponse`
- `StreamSession`, `RankGoal`, `PeakRank`
- `PredictionPreset`, `PredictionAutomationConfig`, `PredictionAutomationRun`
- `CommandUsage`, `Feedback`, `Subscription`
- `CustomBotAccount`
- `Giveaway`, `GiveawayEntry`

Pure prediction-automation types and validation live in `src/models/predictionAutomation.ts`, not in the Sequelize file.

## Schema changes

1. Update the owning model definition.
2. Add a focused script under `src/scripts/` when existing installations need a schema/data migration.
3. Make new non-null fields safe for existing rows with a default or explicit backfill.
4. Make reruns safe where practical.
5. Add a model/service integration test when persistence behavior matters.

Do not rely on `sequelize.sync({ alter: true })` for production migration. Do not edit SQLite files directly.

Existing scripts include migration, recomputation, scope diagnostics, and database inspection. Search `src/scripts/` before creating another one.

## Jobs

| Job | Responsibility |
|---|---|
| `botTokenRefresher.ts` | proactive default-bot token refresh and recovery |
| `customBotTokenRefresher.ts` | per-channel custom-bot credential refresh |
| `cacheUpdater.ts` | THE FINALS leaderboard/cache updates and event stream |
| `streamSessionPoller.ts` | live-channel session tracking and ranked state transitions |
| `peakUpdater.ts` | peak-ranked-score recomputation |

Place periodic orchestration in `src/jobs/`, but keep reusable logic in a service/model/utility.

Job rules:

- Prevent overlapping runs for work that can exceed its interval.
- Make retries bounded and observable.
- Isolate one channel/item failure when a batch can continue safely.
- Clean up timers/listeners on shutdown or replacement paths.
- Record meaningful operational failures through existing logging/event services.
- Export pure helpers or injectable dependencies so important decisions can be unit-tested.

## Runtime files

`cache/`, `data/`, `logs/`, `stats.json`, uploaded assets, and build output are generally generated or mutable runtime state. Change their producer or schema unless the user explicitly asks to edit an artifact.
