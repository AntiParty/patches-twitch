/**
 * Shared timeouts (ms) for outbound HTTP calls.
 *
 * A timeout must always behave as a TRANSIENT failure: never mark a channel
 * auth_revoked or a custom bot inactive because a request timed out.
 */

/** id.twitch.tv / api.twitch.tv */
export const TWITCH_HTTP_TIMEOUT_MS = 10_000;

/** Discord webhook posts */
export const DISCORD_HTTP_TIMEOUT_MS = 5_000;

/** Web -> bot Control API. /add-channel awaits a chat connect, so allow longer. */
export const BOT_CONTROL_TIMEOUT_MS = 20_000;

/** Any other third-party HTTP API */
export const EXTERNAL_HTTP_TIMEOUT_MS = 10_000;

/** AbortSignal for `fetch` that aborts with a TimeoutError after `ms`. */
export function fetchTimeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}
