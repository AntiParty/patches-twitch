# Automatic Ranked Predictions: Concept Brief

## Purpose

FinalsRR already lets a streamer create prediction presets and manually start,
resolve, or cancel Twitch Channel Points predictions from the dashboard or chat.

The proposed feature adds an optional automatic mode for ranked THE FINALS
streams. A streamer configures the rules in the dashboard, FinalsRR opens the
prediction after the stream starts, tracks the stream's ranked-score change, and
settles the prediction when the stream ends.

This document is a product and architecture concept for feedback. It is not an
implementation plan.

## Important Twitch Constraints

- Creating or settling predictions requires the broadcaster OAuth scope
  `channel:manage:predictions`.
- A channel may have only one active or locked prediction at a time.
- Twitch allows a prediction voting window of 30 to 1,800 seconds.
- Twitch currently allows 2 to 10 outcomes, but FinalsRR should intentionally
  keep its product limit at 5 outcomes.
- Prediction questions are limited to 45 characters.
- Outcome labels are limited to 25 characters.
- Twitch requires a prediction to be resolved, canceled, or locked through its
  API. If it is not resolved within Twitch's deadline, Twitch cancels it and
  refunds viewers.

The voting window is not the same as the tracked ranked session. Viewers may
vote for up to 30 minutes, while FinalsRR can keep the prediction locked and
settle it several hours later when the stream ends.

Official reference:
https://dev.twitch.tv/docs/api/reference#create-prediction

## Recommended First Version

Build one narrowly defined automation type first:

**Ranked score change over the current stream.**

Example:

```text
Question: How much RS will I gain this stream?

Outcomes:
1. Down 500 or more
2. Roughly even
3. Up 500 or more
4. Up 1000 or more
```

The streamer may customize:

- Whether automation is enabled.
- Delay after going live before creating the prediction.
- Voting-window duration, from 30 to 1,800 seconds.
- Prediction question.
- Between 2 and 5 outcomes.
- Label and score range for each outcome.

Suggested defaults:

- Disabled by default.
- Start delay: 10 minutes.
- Voting window: 10 minutes.
- THE FINALS category required.
- Resolve when the stream ends.

Manual predictions remain available and are not replaced by this system.

## Proposed Dashboard Area

Add an **Automatic Predictions** card beneath the existing manual prediction
controls.

### Main Controls

- `Enable automatic ranked prediction` toggle.
- Automation status: Disabled, Waiting for stream, Scheduled, Voting, Tracking,
  Resolving, Resolved, Paused, or Needs attention.
- Reauthorize button when prediction permission is missing.
- Current stream and ranked-player connection status.

### Trigger Settings

- Required Twitch category: THE FINALS.
- Start delay after Twitch's stream start time.
- Voting-window duration.
- Resolution trigger: stream ends.

The first version should not offer many trigger types. The interface can be
designed so game-based, timer-based, or event-based triggers may be added later.

### Prediction Builder

- Question input.
- Outcome builder with 2 to 5 rows.
- Each row has a viewer-facing label and a numeric RS range.
- Clear validation that ranges cannot overlap or leave gaps.
- Preview showing exactly what viewers will see.

Example range configuration:

| Label | Minimum Delta | Maximum Delta |
| --- | ---: | ---: |
| Down 500+ | No minimum | -500 |
| Roughly even | -499 | 499 |
| Up 500+ | 500 | 999 |
| Up 1000+ | 1000 | No maximum |

Final delta:

```text
final ranked score - starting ranked score
```

### Live Automation Panel

When a stream is active, show:

- Starting RS.
- Latest known RS.
- Current delta.
- Twitch prediction state.
- Time until creation or voting closure.
- Last successful score update.
- Manual `Resolve`, `Cancel and refund`, and `Disable future runs` actions.

Disabling automation should stop future automatic predictions. It should not
silently abandon an already-running prediction.

## Proposed Runtime Flow

1. Twitch reports that the broadcaster is online.
2. FinalsRR records the Twitch stream start time and starting ranked score.
3. FinalsRR confirms the category is THE FINALS.
4. After the configured delay, FinalsRR checks authorization and whether Twitch
   already has a prediction.
5. If the prediction slot is free, FinalsRR creates the configured prediction.
6. Voting stays open for the configured Twitch voting window.
7. FinalsRR continues tracking ranked score for the rest of the stream.
8. Twitch reports that the stream is offline.
9. FinalsRR obtains a fresh final score, calculates the delta, selects the
   matching outcome, and resolves the exact prediction it created.
10. If a trustworthy final score cannot be obtained, FinalsRR retries briefly
    and then cancels the prediction so viewers are refunded.

## Conflict Rules

Automatic behavior must be conservative:

- Never cancel or replace a manual prediction.
- If another prediction is active when automation wants to start, wait.
- If the stream ends before a slot becomes available, skip the automatic run.
- Create no more than one automatic ranked prediction per Twitch stream.
- Store the exact Twitch prediction and outcome IDs created for the run.
- Never resolve whichever prediction merely happens to be current.
- Allow the streamer or moderators to resolve or cancel manually.

## Score and Stream Reliability

The difficult part is not creating the Twitch prediction. It is deciding which
ranked scores are trustworthy.

The system should persist:

- Twitch channel and stream start timestamp.
- Linked THE FINALS player ID.
- Starting RS and when it was captured.
- Latest RS and when it was captured.
- Created Twitch prediction ID.
- Twitch outcome IDs.
- Automation state and failure reason.

The stream start timestamp should be the unique identity for a run. Persisted
state is required so restarting the web or bot process does not create a second
prediction or lose the ability to settle the first one.

Open score questions:

- Should the baseline be captured immediately when the stream starts or after
  the configured delay?
- How fresh must the starting and final leaderboard records be?
- What happens if the streamer begins playing before the leaderboard updates?
- Should a stream that temporarily disconnects continue the same ranked session?

My recommendation is to capture the earliest reliable score after the stream
starts, display it in the dashboard, and cancel/refund rather than guess when
either endpoint score is unreliable.

## Authorization and Safety

- Automation cannot be enabled until the broadcaster has reauthorized with
  `channel:manage:predictions`.
- Losing prediction permission pauses automation without breaking normal bot
  commands.
- Prediction questions and outcomes pass FinalsRR's blocked-word filter when
  saved and again before creation.
- Twitch AutoMod rejection is displayed as a safe, understandable dashboard
  error.
- Every setting is scoped to the authenticated broadcaster's channel.
- Settings changes use the dashboard's existing CSRF protection.
- Twitch tokens and raw Twitch errors are never returned to the browser.

## Failure Handling

| Situation | Proposed behavior |
| --- | --- |
| Missing OAuth permission | Do not start; show reauthorization requirement |
| Not streaming THE FINALS | Wait without creating a prediction |
| No linked ranked player | Do not enable automation |
| Another prediction is active | Wait; never replace it |
| Twitch creation temporarily fails | Retry with limits while the stream is live |
| Stream ends before creation | Mark the run skipped |
| Final score is temporarily unavailable | Retry for a short configured grace period |
| Final score remains unavailable | Cancel and refund |
| Prediction was manually settled | Reconcile its terminal state and stop |
| Bot or server restarts | Recover from persisted run state |
| Duplicate online/offline events | Process idempotently only once |

## Architecture Direction

FinalsRR runs the dashboard and bot as separate processes, so automatic
prediction state must not live only in memory.

Suggested components:

1. **Automation Configuration**
   Stores each channel's toggle, timing, question, outcomes, and score ranges.

2. **Automation Run**
   Stores one durable state record per Twitch stream, including baseline score
   and exact Twitch IDs.

3. **Automation Evaluator**
   Periodically checks live status, category, delay, authorization, score
   baseline, and prediction availability.

4. **Ranked Score Provider**
   Provides a timestamped ranked score for the linked player and defines whether
   that score is fresh enough to trust.

5. **Stream Finalizer**
   Handles offline events, final-score retries, outcome selection, exact-ID
   settlement, and refunds.

6. **Dashboard API**
   Reads and updates configuration and reports the current automation run.

The evaluator and finalizer should be idempotent. Polling, EventSub events, and
restart recovery may all request the same transition without causing duplicate
predictions or settlements.

## Suggested Delivery Phases

### Phase 1: Observe Only

Track stream start/end and calculate the score delta without creating a Twitch
prediction. Show what outcome FinalsRR would have selected. This validates score
reliability with no Channel Points risk.

### Phase 2: Beta Automation

Allow selected streamers to enable real automatic predictions. Keep visible
manual cancel and resolve controls and detailed run status.

### Phase 3: General Availability

Enable the feature for all eligible streamers after measuring missed scores,
duplicate events, Twitch failures, and manual interventions.

### Phase 4: Additional Automation Types

Potential later triggers include:

- Start a prediction after switching into THE FINALS.
- Resolve after a configurable time instead of stream end.
- Start or settle from a ranked-match event.
- Use different configurations for Ranked, World Tour, or other modes.
- Run a sequence of predictions during one stream.

These should not be part of the first version.

## Questions for External Review

Please critique this proposal, especially:

1. Is a poll-driven, persisted state machine the right architecture for reliable
   Twitch stream automation?
2. How should stale or delayed leaderboard scores be detected?
3. What baseline rule best represents the stream's true starting RS?
4. How should brief stream disconnects or Twitch EventSub delays be handled?
5. Is canceling and refunding always safer than resolving from a possibly stale
   score?
6. How should configurable score ranges be represented and validated?
7. What race conditions exist between manual prediction controls and automation?
8. What database states and unique constraints are needed for restart-safe,
   exactly-once behavior?
9. Should the first production release use fixed outcome ranges instead of fully
   configurable ranges?
10. What important Twitch API, OAuth, moderation, or rate-limit constraints are
    missing?

## Feedback Goal

The desired result is a system that feels simple to the streamer:

> Turn it on, choose when voting opens, define the ranked-score outcomes, and
> trust FinalsRR to settle it safely when the stream ends.

Internally, the priority order should be:

1. Never resolve the wrong prediction.
2. Never guess when score data is unreliable.
3. Never create duplicate predictions.
4. Preserve manual streamer and moderator control.
5. Recover cleanly after process restarts and missed Twitch events.
