# Giveaway Redemption Recovery Design

## Goal

Recover channel-point giveaway entries that Twitch accepted but EventSub did not persist, so the streamer can draw and pay the correct winner from the complete pool.

## Command behavior

Add a production CLI command that accepts a normalized Twitch channel name. It locates the channel and its active giveaway, falling back to the latest giveaway only when no active row exists, and requires a stored reward ID.

The command requests every page of Twitch custom-reward redemptions for both `FULFILLED` and `UNFULFILLED` statuses. Giveaway rewards are configured to auto-fulfill, but querying both statuses safely covers pending redemptions. `CANCELED` redemptions are excluded.

Each Twitch redemption becomes one giveaway entry using the Twitch redemption ID, user ID, and display name. Existing entry rows are compared by redemption ID, making reruns idempotent.

## Safety

The default mode is read-only. It prints the giveaway ID, reward ID, counts returned by Twitch, counts already stored, missing count, and projected total. Writes require an explicit `--apply` flag.

Apply mode inserts only missing entries into the selected giveaway. It does not change giveaway status, winners, the reward, or Twitch redemption status. It refuses to proceed when the channel, giveaway, reward ID, token, or required scope is unavailable.

## Boundaries

Reusable Twitch pagination and reconciliation logic belongs in a focused service with injected fetch/persistence dependencies. The script owns argument parsing, channel/giveaway lookup, dry-run output, and apply confirmation semantics.

## Verification

Unit tests cover pagination across statuses, canceled-redemption exclusion, duplicate redemption IDs, dry-run behavior, and idempotent application. A backend TypeScript build and focused unit test must pass before the command is handed off.
