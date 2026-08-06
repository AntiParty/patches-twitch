# EventSub Redemption Reliability Design

## Goal

Prevent channel-point giveaway entries from being lost when Twitch EventSub disconnects, subscriptions are not restored after restart, or a notification delivery is missed.

## EventSub socket lifecycle

Each broadcaster has one authoritative socket reference. During Twitch's reconnect handoff, the replacement socket becomes authoritative after it connects. Closing the stale socket must not trigger another reconnect. If the authoritative replacement socket later closes unexpectedly, it must reconnect through the normal fresh-session path and recreate tracked subscriptions.

Close handling will decide ownership by comparing the closing socket with the currently stored socket rather than by checking whether the socket was originally created from a reconnect URL. Intentional removal continues to disable reconnects.

## Subscription restoration

Bot startup will track redemption subscriptions for every non-closed redeem giveaway with a stored reward ID, including `open`, `paused`, `locked`, and `drawn` rows. A paused Twitch reward can safely hold an EventSub subscription, ensuring a later resume does not create an unsubscribed window.

Subscription creation, successful restoration, revocation, and failure will include stable structured context: broadcaster ID, giveaway ID, reward ID, and event type. Tokens and Twitch authorization headers must never be logged.

## Automatic reconciliation

The bot process will periodically reconcile `open` redeem giveaways against Twitch's redemption REST API. EventSub remains the low-latency path; reconciliation is the correctness backstop.

Each run retrieves all recent `FULFILLED` and `UNFULFILLED` redemptions using the existing bounded pagination recovery service. It compares redemption IDs and transactionally inserts only missing entries. `CANCELED` redemptions are excluded, and Twitch redemption status is never modified.

Only one reconciliation may run per giveaway at a time. A slow or failing channel must not block other giveaways. Closed, paused, locked, and drawn giveaways are not automatically imported; startup still restores their subscription tracking so a later valid state transition remains connected. The first reconciliation runs shortly after bot/database startup, then repeats every 60 seconds. The interval is stopped during process shutdown.

## Event handling and observability

EventSub redemption handling will return and log a stable outcome: inserted, duplicate, no active redeem giveaway, giveaway not open, or reward mismatch. Silent rejection paths will be removed. Expected duplicates are debug-level; state or reward mismatches are warnings with identifiers only.

Reconciliation logs only when it inserts entries or encounters an error. A successful no-op does not emit an info log every minute.

## Safety and failure handling

- Pagination remains limited to 1,000 pages per status and rejects repeated cursors.
- Database inserts are idempotent on `(giveaway_id, redemption_id)` and execute transactionally.
- Invalid Twitch records are skipped and counted.
- Token refresh continues through the existing channel-points request helper.
- No reconciliation path changes giveaway status, winners, reward state, or Twitch redemption status.
- Process shutdown clears the reconciliation timer and closes EventSub sockets through existing lifecycle controls.

## Verification

Unit tests cover authoritative reconnect-socket ownership, stale socket closes, non-closed restoration selection, reconciliation overlap prevention, per-giveaway failure isolation, successful missing-entry insertion, and stable EventSub outcome classification. Existing EventSub and giveaway tests remain green, followed by the backend TypeScript build and full unit suite.
