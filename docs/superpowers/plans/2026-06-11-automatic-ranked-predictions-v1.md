# Automatic Ranked Predictions v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in, restart-safe automatic THE FINALS ranked predictions that use the existing session ranked-score baseline and settle only the exact Twitch prediction created for that stream.

**Architecture:** Store one channel configuration and one durable automation run per Twitch stream. A poll-driven service evaluates stream/category/session safety, creates predictions through exact Twitch APIs, and delegates offline settlement to an idempotent finalizer. Dashboard APIs and `!rankpred` commands call the same service.

**Tech Stack:** Bun, TypeScript, Express, EJS, Sequelize/SQLite, Twitch Helix/EventSub, Mocha.

---

## File Structure

- Create `src/models/predictionAutomation.ts`: shared types, defaults, parsing, and range validation.
- Create `src/scripts/migrate_prediction_automation.ts`: idempotent SQLite migration.
- Modify `src/db.ts`: Sequelize config/run models and migration wiring.
- Create `src/services/rankedScore.service.ts`: shared current ranked-score lookup.
- Create `src/services/rankedPredictionAutomation.service.ts`: configuration, state evaluation, starting, status, cancellation, and settlement.
- Modify `src/services/twitchPredictions.service.ts`: fetch, resolve, and cancel exact prediction IDs.
- Modify `src/util/twitchUtils.ts`: expose stream ID, category, and Twitch start timestamp.
- Modify `src/jobs/streamSessionPoller.ts`: evaluate automation and finalize offline sessions before cleanup.
- Modify `src/util/twitchEventSubWs.ts`: call the shared finalizer on offline events.
- Create `src/commands/rankpred.ts`: broadcaster/moderator start, status, and cancel controls.
- Modify `src/routes/user/predictions.routes.ts`: automation GET/PUT/start/cancel endpoints.
- Modify `frontend/views/user-dashboard.ejs`: settings and live status UI.
- Add focused unit and integration tests under `src/tests`.

## Delivery Tasks

### Task 1: Persistence and Validation

- [ ] Write failing tests for defaults, 2-5 outcomes, Twitch lengths, full range coverage, no overlaps, and one matching outcome.
- [ ] Write failing integration tests for config/run persistence and `(broadcaster_id, twitch_stream_id)` uniqueness.
- [ ] Implement shared types, validation, migration, and Sequelize models.
- [ ] Run focused tests and TypeScript build.

### Task 2: Exact Twitch Operations

- [ ] Write failing tests for fetching, resolving, and canceling a specified prediction ID.
- [ ] Implement exact-ID operations without current-prediction discovery.
- [ ] Verify manual prediction methods remain unchanged.

### Task 3: Automation Service

- [ ] Write failing tests for safety gates, delay bypass, duplicate stream prevention, category checks, and persisted Twitch IDs.
- [ ] Implement config/status/start evaluation using the existing session score.
- [ ] Write failing tests for delta matching, missing scores, ambiguous outcomes, manual reconciliation, and exact-ID settlement.
- [ ] Implement idempotent finalization and cancel/refund fallbacks.

### Task 4: Stream Lifecycle

- [ ] Extend live stream metadata with stream ID, category, and Twitch start time.
- [ ] Call evaluation from the existing poller.
- [ ] Route EventSub and poller offline cleanup through the shared finalizer.
- [ ] Recover nonterminal runs during normal poll cycles after restarts.

### Task 5: Chat and Dashboard APIs

- [ ] Add `!rankpred start|status|cancel` tests and implementation.
- [ ] Add authenticated, CSRF-protected automation settings and action route tests.
- [ ] Implement GET/PUT/start/cancel endpoints with safe errors.

### Task 6: Dashboard

- [ ] Add shell tests for the Automatic Predictions section.
- [ ] Implement toggle, timing, question, 2-5 range rows, live status, and manual actions.
- [ ] Render all user-authored text with safe DOM APIs.

### Task 7: Verification

- [ ] Run focused automation, prediction, stream-session, command, route, and dashboard tests.
- [ ] Run the full unit suite and integration suite.
- [ ] Run `bun run build`.
- [ ] Confirm unrelated working-tree changes remain untouched.
