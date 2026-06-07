# Chat Prediction Presets Design

## Summary

Add a backend-first Twitch Channel Points Predictions feature that streamers can test entirely through chat. Streamers create reusable prediction presets, while the streamer and their Twitch moderators can start, resolve, or cancel predictions. No dashboard panel or automatic stream/ranked-score trigger is included in this phase.

The implementation must preserve all current bot behavior for channels that have not reauthorized. Only prediction operations are gated behind the new Twitch OAuth scope.

## Goals

- Let a streamer manage reusable prediction presets through chat.
- Let the streamer or a moderator start a preset and resolve or cancel the current prediction.
- Use the broadcaster's stored Twitch user token for all Prediction API calls, including commands initiated by moderators.
- Require `channel:manage:predictions` only when a prediction operation is attempted.
- Survive bot and web process restarts by discovering current prediction state from Twitch.
- Reuse the existing content filter and Discord warning path for all user-authored preset fields.
- Establish a prediction service that future stream-start and ranked-score automation can call without depending on chat parsing.

## Non-Goals

- A dashboard or settings panel.
- Automatically starting a prediction after the stream begins.
- Tracking starting and ending ranked score.
- Automatically resolving a prediction when the stream ends.
- Scheduling, recurring presets, or event-trigger configuration.
- Supporting more than five outcomes, even though Twitch supports up to ten.

## User Experience

### Preset Management

Only the channel broadcaster may manage presets.

```text
!preset p add <alias> | <title> | <outcome 1> | <outcome 2> | ... | [duration seconds]
!preset p list
!preset p show <alias>
!preset p delete <alias>
```

Rules:

- The streamer chooses the alias.
- Aliases contain 1-24 characters, begin with a letter or number, use only letters, numbers, `_`, or `-`, are case-insensitive, and are stored lowercase.
- `add` creates a preset or overwrites the existing preset with the same channel and alias.
- A preset has between two and five outcomes.
- Duration is optional and defaults to 120 seconds.
- An overwrite is atomic: validation failure leaves the previous preset unchanged.
- `list` returns aliases only and uses a bounded message length suitable for Twitch chat.
- `show` returns the title, numbered outcomes, and duration.

The parser treats the final pipe-delimited field as duration only when it is an integer. Otherwise it is another outcome and the default duration applies.

### Prediction Operations

The broadcaster and Twitch moderators may use:

```text
!start p <alias>
!end p <outcome number>
!end p <exact outcome text>
!cancel p
```

Rules:

- `!start p <alias>` loads the channel's preset and creates the Twitch prediction.
- A new prediction is rejected if Twitch reports an existing `ACTIVE` or `LOCKED` prediction.
- `!end p 2` uses the one-based outcome number shown by `!preset p show`.
- Outcome text matching is trimmed and case-insensitive but otherwise exact.
- Ambiguous or unknown outcome input returns the numbered valid outcomes without resolving anything.
- `!cancel p` cancels the current `ACTIVE` or `LOCKED` prediction and Twitch refunds participants.
- Ending and cancellation query Twitch for the latest current prediction rather than depending on in-memory or locally persisted active state.
- A moderator may initiate these commands while still voting because the API request uses the broadcaster's token, not the moderator's identity.

The existing RuneScape cutoff command remains `!predict`; this feature does not claim that command or its aliases.

## Permissions

Broadcaster checks use both the IRC broadcaster badge and a case-insensitive comparison between the sender and channel name. Moderator checks use Twitch IRC badge data.

- Preset add, list, show, and delete: broadcaster only.
- Start, end, and cancel: broadcaster or moderator.
- Bot application roles such as tester, admin, staff, and owner do not grant prediction permissions inside another broadcaster's channel.

Permission checks live in a small shared helper so all prediction commands follow the same policy.

## Content Safety

Before saving a preset, validate all user-authored fields through the existing message-filter functions:

- alias
- title
- every outcome title

The check includes blocked words, blocked phrases, and configured regular expressions. If any field fails:

- reject the entire request;
- do not create or overwrite any row;
- send a short rejection to chat;
- send the existing Discord moderation warning with the channel, actor, command, and rejected field category;
- do not include the rejected content in normal application logs.

Content is validated again immediately before creating a Twitch prediction. This prevents an older stored preset from bypassing newer blocklist rules.

## OAuth And Production Rollout

Add `channel:manage:predictions` to the normal broadcaster OAuth request in `src/routes/auth.routes.ts`. Existing refresh tokens do not gain newly requested scopes, so existing users must visit `/reauth` and approve the updated authorization request.

This is a feature-level gate:

- Channels that have not reauthorized retain all existing bot functionality.
- Preset storage and read-only preset commands do not require the Twitch scope.
- Start, end, and cancel require the broadcaster's current token to include `channel:manage:predictions`.
- A moderator cannot reauthorize on behalf of the broadcaster.

Before a Prediction API operation, validate the decrypted broadcaster access token with Twitch's `/oauth2/validate` endpoint and confirm:

- `channel:manage:predictions` is present;
- the token's `user_id` matches `Channel.twitch_user_id`.

Cache a successful validation for a short bounded period per channel. Clear or replace the cached result when a token refresh returns a new access token. Missing scope produces a focused chat response containing the production `/reauth` URL built from the existing base URL helper.

OAuth/API failure handling:

- Invalid or expired access token: use the existing broadcaster token refresh flow and retry once.
- Missing scope: return the reauthorization response; do not disable the bot and do not set `auth_revoked`.
- Broadcaster ID/token mismatch: fail closed, log an operational error without secrets, and instruct the broadcaster to reauthorize.
- Twitch affiliate/partner restriction: return a clear message that Channel Points Predictions are unavailable for that channel.
- Rate limits or temporary Twitch failures: return a retry-later message and preserve all local preset data.

## Architecture

### Database Model

Add `PredictionPreset` to `src/db.ts` with:

- `id`
- `channel_id`, referencing `Channels.id`
- `alias`
- `title`
- `outcomes_json`
- `duration_seconds`
- `created_at`
- `updated_at`

Use a unique composite index on `(channel_id, alias)`. Store outcomes as JSON text and parse them through a typed repository/service boundary. Add an explicit migration that creates the table and indexes for existing production databases.

No active prediction row is required in phase one because Twitch is the source of truth for active and locked predictions.

### Prediction Service

Create a focused service responsible for:

- loading a broadcaster channel and usable decrypted token;
- validating prediction scope and token ownership;
- refreshing the token and retrying once after authentication failure;
- getting the current `ACTIVE` or `LOCKED` Twitch prediction;
- creating a prediction from validated preset data;
- resolving a current prediction by number or exact title;
- canceling a current prediction;
- translating Twitch errors into stable domain errors suitable for chat.

The service exposes domain methods and contains no chat formatting. Future automation will call these same methods.

### Preset Service

Create a focused preset service responsible for:

- parsing and normalizing aliases;
- validating title, outcome count, duration, and Twitch field limits;
- running content-safety validation;
- atomically upserting a preset;
- listing, loading, and deleting channel-owned presets;
- parsing stored outcome JSON safely.

### Commands

Add thin `preset`, `start`, `end`, and `cancel` command modules. Each module:

- recognizes only the `p` subcommand for this feature;
- delegates permissions to the shared helper;
- delegates business logic to the services;
- formats short threaded chat responses;
- logs failures with module prefixes and no OAuth tokens.

If future features need the generic `!start`, `!end`, or `!cancel` namespaces, their command modules can dispatch additional subcommands without changing prediction services.

## Twitch API Behavior

Use the official Helix endpoints:

- `POST /helix/predictions`
- `GET /helix/predictions`
- `PATCH /helix/predictions`

Requests use the broadcaster's user access token, `TWITCH_CLIENT_ID`, and a `broadcaster_id` matching that token. Resolution sets status `RESOLVED` with the selected Twitch outcome ID. Cancellation sets status `CANCELED`. Twitch allows resolving or canceling a prediction whose current status is `ACTIVE` or `LOCKED`.

Although Twitch permits two to ten outcomes, this product intentionally limits presets to two to five.

## Validation

Validation happens before DB writes and again before Twitch creation:

- alias matches `^[a-z0-9][a-z0-9_-]{0,23}$` after lowercase normalization;
- title contains 1-45 characters;
- outcome count is two through five;
- each outcome contains 1-25 characters and is unique case-insensitively;
- duration is an integer from 30 through 1800 seconds;
- all authored text passes the local content filter.

These limits should be defined once as named constants in the preset service and covered by boundary tests.

## Testing

Unit tests cover:

- broadcaster and moderator permission decisions;
- alias normalization and rejection of spaces;
- pipe-delimited add parsing with and without duration;
- two- and five-outcome acceptance and one- or six-outcome rejection;
- duplicate outcome rejection;
- atomic overwrite behavior after validation failure;
- blocked alias, title, and outcome rejection plus Discord-warning invocation;
- scope present, scope missing, and broadcaster/token mismatch;
- outcome selection by number and case-insensitive exact text;
- current prediction selection across active, locked, and completed results;
- stable mapping of Twitch authentication, eligibility, conflict, and transient errors.

Integration tests cover:

- migration/model uniqueness by channel and alias;
- preset upsert and delete behavior;
- prediction service request payloads with a mocked Twitch HTTP boundary;
- one refresh-and-retry cycle after an expired token;
- missing scope blocking only prediction operations.

Run the existing unit and integration suites plus `bun run build`.

## Future Automation Boundary

A later feature may:

- wait a configurable time after a stream begins in THE FINALS category;
- capture starting ranked score;
- run a long prediction for score bands such as `-500 or worse`, `roughly even`, `+500`, and `+1000 or better`;
- resolve or cancel automatically when the stream ends.

That later work will add trigger/configuration and ranked-score evaluation around the phase-one prediction service. It will not need to duplicate OAuth, Twitch API, active-state discovery, preset validation, or resolution behavior.

## References

- Twitch Predictions guide: https://dev.twitch.tv/docs/api/predictions
- Twitch API reference: https://dev.twitch.tv/docs/api/reference
- Twitch OAuth scopes: https://dev.twitch.tv/docs/authentication/scopes
- Twitch token validation: https://dev.twitch.tv/docs/authentication/validate-tokens
