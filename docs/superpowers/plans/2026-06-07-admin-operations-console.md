# Admin Operations Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current admin dashboard with a secure, responsive operations console that exposes sanitized bot health, durable command analytics, user/channel management, selected-channel messaging, Drops management, and structured audit activity.

**Architecture:** Keep the existing Express, Sequelize, SQLite, and two-process design. Add focused admin routers and service modules that construct explicit response DTOs, add sanitized operational/audit event models to the metrics database, and rebuild the static admin dashboard against those narrow APIs. Remove dangerous browser-facing routes rather than hiding their controls.

**Tech Stack:** TypeScript, Express, Sequelize, SQLite, EJS/static HTML, Chart.js, Mocha, Node assert.

---

## File Structure

- Create `src/services/operationsAnalytics.service.ts`: aggregate command, performance, chat, cache, EventSub, and Control API health into sanitized DTOs.
- Create `src/services/operationalEvents.service.ts`: validate and persist allowlisted operational and admin audit events.
- Create `src/routes/admin/operations.routes.ts`: admin-only overview, health, and audit APIs.
- Create `src/routes/admin/messaging.routes.ts`: admin-only selected-channel messaging with validation and rate limiting.
- Create `src/routes/admin/drops.routes.ts`: staff/admin Drops configuration and upload APIs.
- Modify `src/routes/admin/api.routes.ts`: retain user/channel/subscription management and remove dangerous or duplicated operations.
- Modify `src/routes/admin/index.ts`: mount only approved routers and stop mounting the database editor.
- Modify `src/dbMetrics.ts`: add `OperationalEvent` and `AdminAuditEvent` models and indexes.
- Modify `src/util/adminLogger.ts`: persist sanitized audit records without raw details or message bodies.
- Modify `src/util/commandAnalytics.ts`: expose durable totals and active-command rankings.
- Modify `src/handlers/commands.ts`: expose active registered command names for leaderboard filtering.
- Replace `frontend/views/admin-dashboard.html`: black responsive operations console.
- Replace `src/tests/unit/adminDashboardShell.test.ts`: assert approved navigation, responsive structure, and removed controls.
- Create `src/tests/unit/adminOperationsSecurity.test.ts`: assert allowlists and forbidden-field removal.
- Create `src/tests/unit/operationsAnalytics.test.ts`: assert totals, active-command filtering, and status calculations.
- Create `src/tests/integration/adminOperations.test.ts`: assert permissions, removed endpoints, messaging validation, and Drops access.

### Task 1: Pin Security And Permission Contracts

**Files:**
- Modify: `src/tests/unit/adminDashboardShell.test.ts`
- Create: `src/tests/unit/adminOperationsSecurity.test.ts`
- Create: `src/tests/integration/adminOperations.test.ts`

- [ ] **Step 1: Write failing dashboard tests**

Assert the dashboard contains `Overview`, `Bot Health`, `Channels`, `Users`, `Message Bot`, `Drops`, and `Audit Activity`, includes a mobile bottom navigation and soft-area chart canvas, and excludes `Database`, `System Logs`, `Deploy`, `Restart Bot`, `Refresh Bot Token`, `API Key`, and token labels.

- [ ] **Step 2: Write failing API security tests**

Add recursive assertions that DTOs reject keys matching:

```ts
/(token|secret|password|authorization|credential|oauth|api[_-]?key|cookie|ip|headers|message_content|raw_error)/i
```

Verify staff receives `403` from operations, user, channel, messaging, and audit endpoints while retaining access to Drops endpoints.

- [ ] **Step 3: Run focused tests and confirm failure**

Run:

```bash
bun run test:unit -- --grep "admin operations|admin dashboard"
bun run test:integration -- --grep "admin operations"
```

Expected: failures because the new routers, DTOs, and dashboard markup do not exist yet.

### Task 2: Add Sanitized Event Storage

**Files:**
- Modify: `src/dbMetrics.ts`
- Create: `src/services/operationalEvents.service.ts`
- Modify: `src/util/adminLogger.ts`
- Test: `src/tests/unit/adminOperationsSecurity.test.ts`

- [ ] **Step 1: Add failing event sanitization tests**

Test that event creation keeps only `type`, `severity`, `channel`, `durationMs`, `attemptCount`, `reasonCode`, `actor`, `actorRole`, `target`, and `outcome`.

- [ ] **Step 2: Add metrics models**

Add indexed `OperationalEvent` and `AdminAuditEvent` Sequelize models with timestamps and bounded string fields. Do not add JSON blobs.

- [ ] **Step 3: Implement allowlisted writers**

Implement best-effort writers that normalize identifiers, reject message bodies and secret-like keys, and log persistence failures without throwing into bot workflows.

- [ ] **Step 4: Update admin logging**

Change `logAdminAction` to accept structured arguments, persist a sanitized audit record, and send only sanitized summaries to Discord.

- [ ] **Step 5: Run focused unit tests**

Run:

```bash
bun run test:unit -- --grep "admin operations security"
```

Expected: PASS.

### Task 3: Build Operations Analytics Service

**Files:**
- Create: `src/services/operationsAnalytics.service.ts`
- Modify: `src/util/commandAnalytics.ts`
- Modify: `src/handlers/commands.ts`
- Test: `src/tests/unit/operationsAnalytics.test.ts`

- [ ] **Step 1: Write failing aggregation tests**

Cover:

- Existing command rows contribute to all-time totals.
- Deleted command names remain in totals.
- Only currently registered commands appear in active rankings.
- Failure rate uses failed divided by total executions.
- Status becomes degraded when Control API is unavailable, channels are reconnecting, EventSub is unhealthy, or cache data is stale.

- [ ] **Step 2: Expose active command names**

Add a side-effect-free helper that returns normalized primary command names and aliases from the loader result.

- [ ] **Step 3: Implement range aggregation**

Support `24h`, `7d`, `30d`, and `all` with bounded SQLite queries and timestamp indexes. Build explicit `OperationsOverview` and `BotHealth` DTOs.

- [ ] **Step 4: Read live bot health safely**

Call `http://127.0.0.1:4000/health` and `/metrics/chat` with short timeouts. Convert failures to `unknown`/degraded values without exposing upstream response bodies.

- [ ] **Step 5: Run focused tests**

Run:

```bash
bun run test:unit -- --grep "operations analytics"
```

Expected: PASS.

### Task 4: Split And Secure Admin Routes

**Files:**
- Create: `src/routes/admin/operations.routes.ts`
- Create: `src/routes/admin/messaging.routes.ts`
- Create: `src/routes/admin/drops.routes.ts`
- Modify: `src/routes/admin/api.routes.ts`
- Modify: `src/routes/admin/index.ts`
- Test: `src/tests/integration/adminOperations.test.ts`

- [ ] **Step 1: Add operations endpoints**

Add admin-only endpoints:

```text
GET /admin/api/operations/overview?range=24h
GET /admin/api/operations/health?range=24h
GET /admin/api/operations/audit?limit=50
```

- [ ] **Step 2: Add selected-channel messaging**

Require:

```ts
{
  channels: string[];
  message: string;
}
```

Reject empty arrays, unknown channels, duplicate channels, oversized batches, oversized messages, and wildcard/all-channel values. Forward each validated channel to the bot Control API and audit outcomes without message content.

- [ ] **Step 3: Move Drops routes**

Keep read, update, and image upload behind `requireStaffAPI`. Restrict uploads to approved MIME types and extensions with generated filenames and the current size cap.

- [ ] **Step 4: Remove dangerous routes**

Delete browser-facing handlers for:

```text
/admin/db/*
/admin/api/logs
/admin/api/refresh-bot-token
/admin/api/restart-bot
/admin/api/deploy
/admin/api/pause-bot
/admin/api/resume-bot
/admin/api/simple-users*
/admin/api/user-dashboard-access
```

Stop mounting `database.routes.ts`.

- [ ] **Step 5: Restrict remaining APIs**

Change general stats, analytics, users, channels, subscriptions, commands, feedback, and management actions to admin-only unless they are part of Drops.

- [ ] **Step 6: Run integration tests**

Run:

```bash
bun run test:integration -- --grep "admin operations"
```

Expected: PASS.

### Task 5: Build The Responsive Operations Dashboard

**Files:**
- Replace: `frontend/views/admin-dashboard.html`
- Modify: `src/tests/unit/adminDashboardShell.test.ts`

- [ ] **Step 1: Create semantic shell**

Build pure-black desktop sidebar and mobile bottom navigation. Render navigation based on `/admin/api/me`: staff see only Drops; admins see all approved views.

- [ ] **Step 2: Build Overview and Bot Health**

Add independent loading/error/stale states, summary metric cards, attention list, recent operational activity, active command ranking, and a Chart.js soft area chart with supporting throughput rates.

- [ ] **Step 3: Build management views**

Preserve role changes, bans/unbans, subscription grants/revocations, channel selection, and admin-only messaging. Do not render or retain sensitive hidden fields.

- [ ] **Step 4: Build Drops and Audit views**

Preserve validated Drops editing/upload behavior. Render structured audit records rather than raw logs.

- [ ] **Step 5: Add responsive and interaction polish**

Use 40-pixel minimum hit targets, tabular numerals, balanced headings, explicit transitions, `scale(0.96)` press feedback, and stacked mobile cards with warnings before charts.

- [ ] **Step 6: Run dashboard unit tests**

Run:

```bash
bun run test:unit -- --grep "admin dashboard"
```

Expected: PASS.

### Task 6: Instrument Operational Events

**Files:**
- Modify: `src/util/ircBot.ts`
- Modify: `src/util/twitchEventSubWs.ts`
- Modify: `src/jobs/cacheUpdater.ts`
- Modify: `src/botService.ts`
- Test: `src/tests/unit/adminOperationsSecurity.test.ts`

- [ ] **Step 1: Record IRC lifecycle events**

Record connected, disconnected, reconnect-started, and recovered events using sanitized channel identifiers and numeric attempt counts.

- [ ] **Step 2: Record EventSub lifecycle events**

Record connected and disconnected events without tokens, payload bodies, or raw error objects.

- [ ] **Step 3: Record cache refresh outcomes**

Record success/failure, duration, and a fixed reason code.

- [ ] **Step 4: Record Control API health outcomes**

Persist summarized health check outcomes at a bounded interval rather than on every dashboard request.

- [ ] **Step 5: Run unit tests**

Run:

```bash
bun run test:unit -- --grep "operational event"
```

Expected: PASS.

### Task 7: Full Verification

**Files:**
- Verify all changed files

- [ ] **Step 1: Run formatting and diff checks**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 2: Run build**

Run:

```bash
bun run build
```

Expected: TypeScript compilation succeeds.

- [ ] **Step 3: Run all unit tests**

Run:

```bash
bun run test:unit
```

Expected: all unit tests pass.

- [ ] **Step 4: Run integration tests**

Run:

```bash
bun run test:integration
```

Expected: all available integration tests pass.

- [ ] **Step 5: Verify in browser**

Run the web process, open `/admin`, verify admin and staff navigation, desktop and mobile breakpoints, independent panel failures, selected-channel messaging validation, and the soft area chart.

- [ ] **Step 6: Review security surface**

Search the admin dashboard and mounted admin routers for:

```text
token
secret
database
logs
deploy
restart
api key
send all
```

Expected: no dangerous UI or mounted browser-facing route remains; legitimate negative security tests and documentation may still contain these terms.
