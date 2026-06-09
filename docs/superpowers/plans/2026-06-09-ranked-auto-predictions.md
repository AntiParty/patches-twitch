# Ranked Auto Predictions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in dashboard feature that starts a fixed THE FINALS ranked prediction after a configurable delay and resolves it from stream-session ranked-score change.

**Architecture:** Persist channel configuration and one automation run per Twitch stream. A poll-driven runner evaluates live category, delay, session baseline, OAuth, and Twitch prediction availability; a shared offline finalizer resolves the exact stored prediction ID or cancels after a five-minute score retry window. The dashboard uses authenticated, CSRF-protected APIs and builds on the existing manual prediction preset services.

**Tech Stack:** Bun, TypeScript, Express, EJS, Sequelize/SQLite, Twitch Helix, EventSub WebSocket, Mocha, Node `assert`.

---

## File Structure

- Modify `.gitignore`: ignore the local `.worktrees/` execution directory.
- Integrate `src/services/predictionPreset.service.ts`, `src/services/twitchPredictions.service.ts`, `src/routes/user/predictions.routes.ts`, and tests from the reviewed dashboard backend branch.
- Modify `src/db.ts`: declare and initialize automation config/run models.
- Create `src/scripts/migrate_prediction_automation.ts`: idempotent production migration.
- Create `src/services/rankedScore.service.ts`: shared leaderboard lookup.
- Modify `src/commands/record.ts`: consume ranked-score service.
- Modify `src/util/twitchUtils.ts`: return stream category and Twitch start time.
- Extend `src/services/twitchPredictions.service.ts`: exact-ID fetch, resolve, and cancel.
- Create `src/services/rankedPredictionAutomation.service.ts`: constants, boundaries, config validation, run evaluation, and recovery.
- Create `src/services/streamFinalization.service.ts`: offline score retries and exact prediction settlement.
- Modify `src/jobs/streamSessionPoller.ts`: call runner/finalizer rather than deleting sessions directly.
- Modify `src/util/twitchEventSubWs.ts`: delegate offline finalization.
- Modify `src/botService.ts`: recover persisted automation runs at startup.
- Extend `src/routes/user/predictions.routes.ts`: automation GET/PUT APIs.
- Modify `frontend/views/user-dashboard.ejs`: Predictions view, manual presets, and Auto Ranked settings.
- Add focused unit and integration tests under `src/tests`.

### Task 1: Integrate The Reviewed Prediction Dashboard Backend

**Files:**
- Modify: `.gitignore`
- Modify: `src/services/predictionPreset.service.ts`
- Modify: `src/services/twitchPredictions.service.ts`
- Create: `src/routes/user/predictions.routes.ts`
- Modify: `src/routes/user/index.ts`
- Modify/Create: prediction unit tests from the reviewed branch

- [ ] **Step 1: Ignore the local execution worktree**

Add:

```gitignore
.worktrees/
```

- [ ] **Step 2: Cherry-pick the reviewed backend commits**

Run:

```powershell
git cherry-pick d8a0c82185168e78880943aa0ad8179abf95bd58
git cherry-pick 54e7420d0ba1219570282ed78e63a5f24c21c54b
git cherry-pick 8086d4fb2e980eb84198398681664ac5504b75c8
git cherry-pick c4dd8801560e778e5029d23ef513ba3068f015fc
git cherry-pick c16b2d15bd7b79928e2f083220480b82e3613f94
git cherry-pick 2c239beb41df8045667ec714641c3ed8d2156251
git cherry-pick 8f2ca926d8a30504aca9217500d6bc8304d9de79
```

Expected: structured preset saving, stable authorization status, the public prediction reauth URL, and authenticated preset CRUD routes land on `main`.

- [ ] **Step 3: Run the reviewed backend tests**

Run:

```powershell
bun run test:unit -- --grep "Prediction preset|Prediction chat commands|Twitch predictions|Prediction dashboard routes"
bun run build
```

Expected: all focused tests and TypeScript build pass.

- [ ] **Step 4: Commit the worktree ignore**

```powershell
git add .gitignore
git commit -m "chore: ignore local worktrees"
```

### Task 2: Persist Automation Configuration And Runs

**Files:**
- Modify: `src/db.ts`
- Create: `src/scripts/migrate_prediction_automation.ts`
- Create: `src/tests/integration/predictionAutomationModel.test.ts`

- [ ] **Step 1: Write failing model and migration tests**

Create tests that call the migration twice and assert:

```ts
const config = await PredictionAutomationConfig.create({
  channel_id: channel.id,
  enabled: true,
  start_delay_minutes: 10,
  voting_window_seconds: 1800,
});

const run = await PredictionAutomationRun.create({
  channel_id: channel.id,
  stream_started_at: new Date('2026-06-09T12:00:00Z'),
  session_start_score: 50000,
  status: 'scheduled',
});

assert.equal(config.enabled, true);
assert.equal(run.status, 'scheduled');
```

Also assert that a second run with the same `(channel_id, stream_started_at)` fails the unique constraint.

- [ ] **Step 2: Run the test and verify failure**

```powershell
bun run test:integration -- --grep "Prediction automation models"
```

Expected: FAIL because the models and tables do not exist.

- [ ] **Step 3: Implement the idempotent migration**

Create `migratePredictionAutomation(queryInterface)` that creates:

```ts
PredictionAutomationConfigs(
  id,
  channel_id UNIQUE,
  enabled DEFAULT false,
  start_delay_minutes DEFAULT 10,
  voting_window_seconds DEFAULT 1800,
  created_at,
  updated_at
)

PredictionAutomationRuns(
  id,
  channel_id,
  stream_started_at,
  session_start_score,
  prediction_id NULL,
  outcomes_json NULL,
  status,
  offline_detected_at NULL,
  resolution_deadline_at NULL,
  last_resolution_attempt_at NULL,
  terminal_reason NULL,
  created_at,
  updated_at
)
```

Add a unique index on `(channel_id, stream_started_at)` and normal indexes on `status` and `channel_id`.

- [ ] **Step 4: Declare Sequelize models**

In `src/db.ts`, add and export `PredictionAutomationConfig` and `PredictionAutomationRun`, initialize their fields with snake-case column names, invoke the migration during DB startup, and retain `timestamps: false` because timestamps are explicit.

- [ ] **Step 5: Run tests and build**

```powershell
bun run test:integration -- --grep "Prediction automation models"
bun run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/db.ts src/scripts/migrate_prediction_automation.ts src/tests/integration/predictionAutomationModel.test.ts
git commit -m "feat: persist prediction automation state"
```

### Task 3: Extract Ranked Score Lookup And Stream Metadata

**Files:**
- Create: `src/services/rankedScore.service.ts`
- Modify: `src/commands/record.ts`
- Modify: `src/jobs/streamSessionPoller.ts`
- Modify: `src/util/twitchUtils.ts`
- Create: `src/tests/unit/rankedScore.test.ts`
- Create: `src/tests/unit/twitchStreamMetadata.test.ts`

- [ ] **Step 1: Write ranked-score service tests**

Test:

```ts
findRankedPlayer(data, 'Name#1234')
getRankedScore('Name#1234')
```

Required behavior:

- exact case-insensitive Embark ID match first;
- existing base-name fallback when the tag is unavailable;
- return `rankScore` as a number;
- return `null` for missing cache/player/score.

- [ ] **Step 2: Write stream metadata tests**

Mock the Helix streams response and assert:

```ts
{
  username: 'antiparty',
  thumbnailUrl: 'https://.../320x180.jpg',
  gameId: '12345',
  gameName: 'THE FINALS',
  startedAt: new Date('2026-06-09T12:00:00Z')
}
```

Invalid `started_at` must omit that stream entry and log a warning because automation cannot identify the stream safely.

- [ ] **Step 3: Run focused tests and verify failure**

```powershell
bun run test:unit -- --grep "Ranked score service|Twitch stream metadata"
```

Expected: FAIL because the service and metadata fields do not exist.

- [ ] **Step 4: Implement `rankedScore.service.ts`**

Export:

```ts
export interface RankedPlayer {
  name: string;
  rankScore?: number;
}

export function findRankedPlayer(data: RankedPlayer[] | null, playerId: string): RankedPlayer | null;
export async function getCurrentRankedScore(playerId: string): Promise<number | null>;
```

Use `getLatestLeaderboardData()` as the cache boundary initially.

- [ ] **Step 5: Replace duplicate player matching**

Update `record.ts` and `streamSessionPoller.ts` to call the shared service. Keep chat messages and session behavior unchanged.

- [ ] **Step 6: Extend live stream results**

Change `getLiveStreamsForUsers` to return:

```ts
export interface TwitchLiveStream {
  username: string;
  thumbnailUrl?: string;
  gameId: string;
  gameName: string;
  startedAt: Date;
}
```

Populate fields on every paginated result.

- [ ] **Step 7: Run tests and build**

```powershell
bun run test:unit -- --grep "Ranked score service|Twitch stream metadata|regular rank"
bun run build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/services/rankedScore.service.ts src/commands/record.ts src/jobs/streamSessionPoller.ts src/util/twitchUtils.ts src/tests/unit/rankedScore.test.ts src/tests/unit/twitchStreamMetadata.test.ts
git commit -m "refactor: share ranked stream metadata"
```

### Task 4: Add Exact Prediction Operations And Outcome Rules

**Files:**
- Modify: `src/services/twitchPredictions.service.ts`
- Create: `src/services/rankedPredictionOutcomes.service.ts`
- Modify: `src/tests/unit/twitchPredictions.test.ts`
- Create: `src/tests/unit/rankedPredictionOutcomes.test.ts`

- [ ] **Step 1: Write exact-ID Twitch tests**

Add tests proving:

```ts
await service.getById(channelId, predictionId);
await service.resolveById(channelId, predictionId, outcomeId);
await service.cancelById(channelId, predictionId);
```

Every request must use the broadcaster token and IDs supplied by the caller. `resolveById` sends:

```json
{
  "broadcaster_id": "broadcaster-1",
  "id": "prediction-1",
  "status": "RESOLVED",
  "winning_outcome_id": "up-500-id"
}
```

- [ ] **Step 2: Write exhaustive boundary tests**

Assert:

```ts
selectRankedOutcome(-500).key === 'down_500'
selectRankedOutcome(-499).key === 'roughly_even'
selectRankedOutcome(499).key === 'roughly_even'
selectRankedOutcome(500).key === 'up_500'
selectRankedOutcome(999).key === 'up_500'
selectRankedOutcome(1000).key === 'up_1000'
```

- [ ] **Step 3: Run focused tests and verify failure**

```powershell
bun run test:unit -- --grep "Twitch predictions service|Ranked prediction outcomes"
```

Expected: FAIL because exact-ID methods and outcome selection do not exist.

- [ ] **Step 4: Implement fixed outcomes**

Export:

```ts
export const RANKED_PREDICTION_TITLE = 'How will this ranked session go?';
export const RANKED_PREDICTION_OUTCOMES = [
  { key: 'down_500', title: 'Down 500+' },
  { key: 'roughly_even', title: 'Roughly even' },
  { key: 'up_500', title: 'Up 500+' },
  { key: 'up_1000', title: 'Up 1000+' },
] as const;
```

Implement `selectRankedOutcome(delta)` with the approved boundaries.

- [ ] **Step 5: Implement exact-ID methods**

Keep the existing chat/current-prediction methods unchanged. Exact methods must map already-terminal Twitch state to stable domain results so finalization can reconcile rather than touch another prediction.

- [ ] **Step 6: Run tests and build**

```powershell
bun run test:unit -- --grep "Twitch predictions service|Ranked prediction outcomes|Prediction chat commands"
bun run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/services/twitchPredictions.service.ts src/services/rankedPredictionOutcomes.service.ts src/tests/unit/twitchPredictions.test.ts src/tests/unit/rankedPredictionOutcomes.test.ts
git commit -m "feat: add exact ranked prediction settlement"
```

### Task 5: Add Automation Configuration Service And API

**Files:**
- Create: `src/services/predictionAutomationConfig.service.ts`
- Modify: `src/routes/user/predictions.routes.ts`
- Create: `src/tests/unit/predictionAutomationConfig.test.ts`
- Modify: `src/tests/unit/predictionDashboardRoutes.test.ts`

- [ ] **Step 1: Write config service tests**

Test defaults:

```ts
{
  enabled: false,
  startDelayMinutes: 10,
  votingWindowSeconds: 1800
}
```

Test bounds:

- delay: 1 through 60 minutes;
- voting: 30 through 1800 seconds;
- booleans and integers required.

Test enabling failures for missing player ID and authorization status other than `ready`.
Test that disabling automation while a run is active changes future configuration only and does not cancel or mutate that run.

- [ ] **Step 2: Write API tests**

Add:

```text
GET /api/user/predictions/automation
PUT /api/user/predictions/automation
```

Assert session channel scoping, CSRF wiring, ignored client `channelId`, normalized config, relative `/reauth`, and no token fields.

- [ ] **Step 3: Run tests and verify failure**

```powershell
bun run test:unit -- --grep "Prediction automation config|Prediction dashboard routes"
```

Expected: FAIL.

- [ ] **Step 4: Implement config service**

Expose:

```ts
get(channelId): Promise<PredictionAutomationConfigData>
save(channel, input: unknown): Promise<PredictionAutomationConfigData>
```

Only require linked player and ready authorization when transitioning to `enabled: true`.

- [ ] **Step 5: Implement API handlers**

GET returns:

```json
{
  "config": {},
  "authorization": {},
  "run": null
}
```

PUT returns the saved normalized config. Use `requireUserAPI` and `csrfProtection`.

- [ ] **Step 6: Run tests and build**

```powershell
bun run test:unit -- --grep "Prediction automation config|Prediction dashboard routes"
bun run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/services/predictionAutomationConfig.service.ts src/routes/user/predictions.routes.ts src/tests/unit/predictionAutomationConfig.test.ts src/tests/unit/predictionDashboardRoutes.test.ts
git commit -m "feat: configure ranked auto predictions"
```

### Task 6: Implement The Persisted Automation Runner

**Files:**
- Create: `src/services/rankedPredictionAutomation.service.ts`
- Modify: `src/jobs/streamSessionPoller.ts`
- Create: `src/tests/unit/rankedPredictionAutomation.test.ts`

- [ ] **Step 1: Write runner tests**

Cover:

- disabled config does nothing;
- non-THE FINALS category does nothing;
- missing session does nothing;
- delay uses Twitch `startedAt`;
- category switch into THE FINALS after elapsed delay starts immediately;
- one run per channel/stream;
- active manual prediction leaves run scheduled;
- temporary Twitch failure leaves run scheduled;
- missing OAuth marks run skipped with `reauth_required`;
- successful start stores prediction ID and Twitch outcome IDs;
- repeated poll after success does not create again.

- [ ] **Step 2: Run tests and verify failure**

```powershell
bun run test:unit -- --grep "Ranked prediction automation"
```

Expected: FAIL.

- [ ] **Step 3: Implement runner dependencies**

Define injectable dependencies for:

```ts
loadConfig
loadSession
findOrCreateRun
getCurrentPrediction
startPrediction
updateRun
now
```

Keep Sequelize and Twitch calls behind these boundaries.

- [ ] **Step 4: Implement evaluation**

Export:

```ts
evaluateLiveStream(channel: ChannelLike, stream: TwitchLiveStream): Promise<void>
recoverRuns(liveStreams: TwitchLiveStream[]): Promise<void>
```

Create a scheduled run once prerequisites and delay/category rules are met. Use the fixed title/outcomes and configured voting window.

- [ ] **Step 5: Wire into poller**

After sessions are created/updated, evaluate every live stream. Do not add independent timers.

- [ ] **Step 6: Run tests and build**

```powershell
bun run test:unit -- --grep "Ranked prediction automation|Twitch predictions service"
bun run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/services/rankedPredictionAutomation.service.ts src/jobs/streamSessionPoller.ts src/tests/unit/rankedPredictionAutomation.test.ts
git commit -m "feat: start ranked predictions automatically"
```

### Task 7: Implement Idempotent Stream Finalization

**Files:**
- Create: `src/services/streamFinalization.service.ts`
- Modify: `src/util/twitchEventSubWs.ts`
- Modify: `src/jobs/streamSessionPoller.ts`
- Create: `src/tests/unit/streamFinalization.test.ts`

- [ ] **Step 1: Write finalizer tests**

Cover:

- no run: delete session immediately;
- scheduled run with no prediction: mark skipped and delete session;
- final score found: calculate delta, select outcome, resolve exact stored ID, mark resolved, then delete session;
- score unavailable: set persisted five-minute deadline and retain session;
- retry no more than once per minute;
- score appears before deadline: resolve;
- deadline expires: cancel exact stored ID and delete session;
- duplicate offline calls do not double-resolve/cancel;
- stored prediction already terminal: reconcile and clean up;
- temporary token/Twitch failure retries until deadline;
- no path resolves or cancels an unrelated current prediction.

- [ ] **Step 2: Run tests and verify failure**

```powershell
bun run test:unit -- --grep "Stream finalization"
```

Expected: FAIL.

- [ ] **Step 3: Implement finalizer**

Export:

```ts
finalizeOfflineChannel(channelId: number, username: string): Promise<void>
processResolvingRuns(): Promise<void>
```

Persist:

```ts
offline_detected_at = first detection time
resolution_deadline_at = offline_detected_at + 5 minutes
last_resolution_attempt_at = current attempt time
```

- [ ] **Step 4: Replace direct deletion**

In `twitchEventSubWs.ts`, replace `StreamSession.destroy` in `handleStreamOffline` with the finalizer.

In `streamSessionPoller.ts`, replace stale offline-session deletion with the same finalizer and call `processResolvingRuns()` each tick.

- [ ] **Step 5: Run tests and build**

```powershell
bun run test:unit -- --grep "Stream finalization|Ranked prediction automation|Twitch EventSub"
bun run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/services/streamFinalization.service.ts src/util/twitchEventSubWs.ts src/jobs/streamSessionPoller.ts src/tests/unit/streamFinalization.test.ts
git commit -m "feat: settle ranked predictions at stream end"
```

### Task 8: Build The Predictions Dashboard

**Files:**
- Modify: `frontend/views/user-dashboard.ejs`
- Create: `src/tests/unit/predictionDashboardShell.test.ts`

- [ ] **Step 1: Write failing shell tests**

Assert the EJS contains:

```text
data-view="predictions"
id="view-predictions"
id="prediction-status"
id="prediction-preset-form"
id="prediction-automation-form"
id="prediction-automation-enabled"
id="prediction-start-delay"
id="prediction-voting-window"
/api/user/prediction-presets
/api/user/predictions/automation
```

Assert authored preset values are rendered with `textContent`, not string interpolation into `innerHTML`.

- [ ] **Step 2: Run test and verify failure**

```powershell
bun run test:unit -- --grep "Prediction dashboard shell"
```

Expected: FAIL.

- [ ] **Step 3: Add Predictions navigation and status**

Add a sidebar item and view. Display authorization states:

- ready;
- reauthorization required with `/reauth`;
- unavailable;
- temporarily unavailable.

- [ ] **Step 4: Add manual preset management**

Implement list/create/edit/delete for alias, title, two to five outcomes, and voting duration. Reuse dashboard CSRF, toast, and confirmation helpers.

- [ ] **Step 5: Add Auto Ranked settings**

Add:

```html
<input type="checkbox" id="prediction-automation-enabled">
<input type="number" id="prediction-start-delay" min="1" max="60">
<input type="number" id="prediction-voting-window" min="30" max="1800">
```

Show the fixed outcome preview and explain that voting closes before stream-end settlement.

- [ ] **Step 6: Add safe client logic**

Use DOM creation and `textContent` for preset data. Disable duplicate submissions. Confirm preset overwrite/delete. POST/PUT/DELETE requests include `X-CSRF-Token`.

- [ ] **Step 7: Run shell tests and build**

```powershell
bun run test:unit -- --grep "Prediction dashboard shell|Prediction dashboard routes"
bun run build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add frontend/views/user-dashboard.ejs src/tests/unit/predictionDashboardShell.test.ts
git commit -m "feat: add ranked prediction dashboard"
```

### Task 9: Startup Recovery And Complete Verification

**Files:**
- Modify: `src/botService.ts`
- Modify if required: automation/finalization files
- Test: focused and full suites

- [ ] **Step 1: Write startup recovery test**

Test that bot startup invokes automation recovery after DB readiness without starting a second interval.

- [ ] **Step 2: Implement startup recovery**

Call a one-shot recovery method after stored tokens/services load. The recurring poller remains the only interval owner.

- [ ] **Step 3: Run focused tests**

```powershell
bun run test:unit -- --grep "Prediction|prediction|Stream finalization|stream metadata|Ranked score"
bun run test:integration -- --grep "Prediction|prediction"
```

Expected: PASS.

- [ ] **Step 4: Run full suites**

```powershell
bun run test:unit
bun run test:integration
bun run build
```

Expected: no new failures. Record the known randomized `myrank` failures separately if they reproduce; do not modify unrelated rank command behavior.

- [ ] **Step 5: Inspect branch and diff**

```powershell
git diff --check
git status --short
git log --oneline --decorate -15
```

Expected: no feature-file whitespace errors; only intentional commits on `main`; user processes were not started.

- [ ] **Step 6: Manual verification run by the user**

Ask the user to run their normal server and bot commands, then verify:

```text
1. Reauthorize and confirm Predictions status is Ready.
2. Enable automation with a short test delay and voting window.
3. Go live in a non-THE FINALS category: no prediction.
4. Switch to THE FINALS: one prediction starts.
5. Confirm repeated polls do not duplicate it.
6. End stream with a leaderboard score available: exact prediction resolves.
7. Repeat with score unavailable: prediction cancels/refunds after five minutes.
8. Restart bot during an active run: persisted run recovers.
9. Manual !p and legacy prediction commands still work.
```

- [ ] **Step 7: Final review**

Request a full diff review against `docs/superpowers/specs/2026-06-09-ranked-auto-predictions-design.md` before pushing `main`.
