# Ranked Auto Predictions Design

## Summary

Add an opt-in dashboard feature that automatically starts a fixed ranked-session Twitch Channel Points Prediction for THE FINALS streams and resolves it from the broadcaster's ranked-score change when the stream ends.

The streamer controls whether automation is enabled, the delay after stream start, and the Twitch voting window. The prediction remains active or locked for the rest of the stream, then resolves against the final leaderboard score. If the final score is unavailable, the bot retries for five minutes and then cancels the prediction so Channel Points are refunded.

This feature builds on the existing broadcaster OAuth, Twitch prediction service, stream-session tracking, and dashboard prediction work. It does not replace manual presets or manual prediction commands.

## Goals

- Give streamers an explicit dashboard toggle for ranked auto predictions.
- Start only while the broadcaster is live in THE FINALS category.
- Use the stream's captured starting ranked score as the scoring baseline.
- Let streamers configure start delay and voting duration within Twitch limits.
- Resolve the exact auto-created prediction when the stream ends.
- Recover safely after bot restarts and duplicate online/offline signals.
- Cancel and refund after five minutes when a final ranked score cannot be obtained.
- Keep unrelated bot features working when prediction OAuth authorization is missing.

## Non-Goals

- Editable score bands or outcome labels in the first version.
- World Tour or other game-mode scoring.
- More than one automatic prediction per stream.
- Starting automation in categories other than THE FINALS.
- Automatically enabling the feature for existing users.
- Using a manual preset as the automation template.

## Dashboard Experience

The existing user dashboard gains a `Predictions` view. It contains:

1. Prediction OAuth status and a `/reauth` action when `channel:manage:predictions` is missing.
2. Manual preset management from the approved prediction dashboard design.
3. An `Auto Ranked Prediction` settings card.

The auto-ranked settings are:

- **Enable auto ranked prediction:** off by default.
- **Start delay:** integer from 1 through 60 minutes, default 10.
- **Voting window:** integer from 30 through 1,800 seconds, default 1,800.

The card previews the fixed prediction:

```text
Title: How will this ranked session go?
1. Down 500+
2. Roughly even
3. Up 500+
4. Up 1000+
```

The dashboard explains that voting closes after the configured window, but the prediction remains unresolved until the stream ends.

Enabling is rejected unless:

- the authenticated channel has a linked THE FINALS player ID;
- the broadcaster Twitch token includes `channel:manage:predictions`;
- the Twitch token belongs to that broadcaster.

Disabling automation prevents future starts. If an automatic prediction is already active for the current stream, disabling does not cancel it; the bot still resolves or refunds that run.

## Outcome Boundaries

The final score delta is `final ranked score - stream starting ranked score`.

The boundaries are exhaustive and non-overlapping:

- `Down 500+`: delta less than or equal to `-500`.
- `Roughly even`: delta from `-499` through `+499`.
- `Up 500+`: delta from `+500` through `+999`.
- `Up 1000+`: delta greater than or equal to `+1000`.

These labels and boundaries are fixed in version one.

## Trigger Rules

The stream-status query must expose:

- Twitch username;
- thumbnail URL;
- `game_id`;
- `game_name`;
- Twitch `started_at`.

The automation evaluator runs with the existing stream polling cadence and uses Twitch `started_at`, not first local detection time.

For each live channel with automation enabled:

1. Confirm `game_name` is exactly `THE FINALS`, case-insensitively.
2. Confirm the channel has a linked player and an active `StreamSession` with a valid starting score.
3. Confirm the configured delay has elapsed since Twitch `started_at`.
4. Confirm no automation run has already been created for that Twitch stream start.
5. Confirm Twitch has no active or locked prediction.
6. Confirm broadcaster prediction authorization.
7. Create the fixed prediction with the configured voting window.
8. Persist the Twitch prediction and outcome IDs in the automation run.

If the category is not THE FINALS when the delay elapses, the evaluator waits. If the streamer changes into THE FINALS later during the same stream, the prediction starts on the next evaluation because the original delay has already elapsed.

If Twitch already has an active or locked manual prediction, automation waits rather than canceling or replacing it. It may start later during the same stream once the slot becomes available.

Only one automatic prediction may be created for a Twitch stream identified by channel plus Twitch `started_at`.

## Stream-End Resolution

Both EventSub `stream.offline` and poller-detected offline state call one idempotent stream-finalization service.

For an auto-prediction run:

1. Mark the run as resolving and persist `offline_detected_at`.
2. Read the latest regular ranked leaderboard score for the linked player.
3. If found, calculate the delta, select the fixed outcome, and resolve the exact stored Twitch prediction ID.
4. Mark the run resolved and delete the completed `StreamSession`.
5. If the score is unavailable, retry once per minute until five minutes after `offline_detected_at`.
6. After the deadline, cancel the exact stored prediction ID and mark the run canceled.
7. Delete the completed `StreamSession` after resolution or cancellation.

The finalizer must not resolve or cancel whichever prediction happens to be current. It acts only on the Twitch prediction ID stored for the automatic run. This avoids affecting a later manual prediction.

If Twitch reports that the stored prediction was already resolved or canceled manually, record that terminal state and clean up without touching any other prediction.

When no auto run exists, stream-session cleanup retains its current behavior.

## Persistence

### `PredictionAutomationConfig`

Add a channel-owned configuration model:

- `id`
- `channel_id`, unique and referencing `Channels.id`
- `enabled`, default false
- `start_delay_minutes`, default 10
- `voting_window_seconds`, default 1800
- `created_at`
- `updated_at`

### `PredictionAutomationRun`

Add a persisted per-stream state model:

- `id`
- `channel_id`
- `stream_started_at`
- `session_start_score`
- `prediction_id`, nullable until Twitch creation succeeds
- `outcomes_json`, storing Twitch outcome IDs and titles
- `status`: `scheduled`, `active`, `resolving`, `resolved`, `canceled`, or `skipped`
- `offline_detected_at`, nullable
- `resolution_deadline_at`, nullable
- `last_resolution_attempt_at`, nullable
- `terminal_reason`, nullable
- `created_at`
- `updated_at`

Use a unique composite index on `(channel_id, stream_started_at)`.

Run state is persisted before and after external Twitch calls so duplicate poll ticks, duplicate EventSub events, and process restarts remain idempotent.

Add explicit idempotent SQLite migrations for both tables and indexes.

## Service Boundaries

### Ranked Score Service

Extract the repeated leaderboard player lookup from the stream poller and `!record` into a small service:

- load latest regular leaderboard data;
- match exact Embark ID, with the existing base-name fallback;
- return the current ranked score or `null`.

No World Tour data is used.

### Automation Configuration Service

Responsible for:

- reading defaults when no row exists;
- validating delay and voting-window bounds;
- enabling only when linked-player and OAuth prerequisites pass;
- upserting channel-owned settings.

### Automation Runner

Responsible for:

- evaluating live stream metadata and configuration;
- creating one persisted run per Twitch stream;
- starting the fixed prediction through the Twitch prediction service;
- waiting when another prediction occupies the channel;
- recovering scheduled, active, or resolving runs on startup/poll ticks.

### Stream Finalization Service

Responsible for:

- idempotent offline handling;
- final-score retry scheduling;
- exact prediction resolution/cancellation;
- terminal run state;
- final `StreamSession` cleanup.

EventSub and the stream poller delegate to this service instead of independently deleting sessions.

### Twitch Prediction Service

Extend the existing service with exact-ID operations used by automation:

- resolve a specified prediction using a stored outcome ID;
- cancel a specified prediction;
- fetch a specified prediction when reconciling state.

Manual chat methods continue using current-prediction discovery.

## API

Add authenticated dashboard endpoints:

```text
GET /api/user/predictions/automation
PUT /api/user/predictions/automation
```

The GET response contains:

- normalized config;
- prediction authorization status;
- current automation run summary, if one exists.

The PUT body accepts only:

```json
{
  "enabled": true,
  "startDelayMinutes": 10,
  "votingWindowSeconds": 1800
}
```

The channel always comes from the authenticated session. Mutations require existing CSRF protection. Responses never contain Twitch tokens or raw Twitch errors.

## Error Handling

- Missing prediction scope: reject enabling with `reauth_required` and `/reauth`.
- Missing linked player: reject enabling with a clear dashboard message.
- Twitch temporary failure at start: leave the run scheduled and retry on a later poll.
- Existing active prediction: leave the run scheduled and retry later.
- Stream ends before automatic prediction starts: mark the run skipped and clean up the session.
- Final score unavailable: retry for five minutes, then cancel/refund.
- Exact stored prediction already terminal: reconcile state and clean up.
- Token refresh failure during finalization: continue retrying until the same five-minute deadline, then make a final cancellation attempt and record the failure safely if Twitch remains unavailable.

No automation failure sets `auth_revoked` or disables unrelated bot functionality.

## Restart Recovery

On bot startup and every poll:

- scheduled runs are reevaluated if their stream is still live;
- active runs remain associated with their stored Twitch prediction;
- resolving runs continue final-score retries until their persisted deadline;
- offline streams with an active run enter finalization even if EventSub was missed.

The system does not depend on in-memory timers for correctness.

## Testing

Unit tests cover:

- config defaults and bounds;
- enabling prerequisites;
- exact outcome-boundary selection;
- THE FINALS category matching;
- delay calculations from Twitch `started_at`;
- one-run-per-stream idempotency;
- waiting for an existing manual prediction;
- exact-ID resolve/cancel behavior;
- duplicate offline events;
- score retry cadence and five-minute deadline;
- terminal-state reconciliation;
- restart recovery;
- session cleanup ordering;
- authenticated API channel scoping and CSRF wiring.

Integration tests cover:

- config and run migrations;
- unique stream-run constraint;
- persisted run recovery;
- dashboard config create/update;
- finalization with mocked Twitch and leaderboard boundaries.

Run focused prediction/stream-session tests, the full unit and integration suites, and `bun run build`.

## Rollout

- Automation is disabled for every existing channel.
- Existing manual prediction commands and presets remain unchanged.
- Existing channels must reauthorize before enabling automation.
- Deploy migrations before starting the bot process.
- The dashboard should describe the feature as beta during the first production rollout.
