# Auth and tokens

## Which token for what

| Token | Get it via | Use for |
|---|---|---|
| App access token | Client credentials grant | Conduits, webhook subscriptions, sending chat as a badged bot, public lookups |
| Broadcaster user token | Authorization code grant, broadcaster signs in | Channel points, predictions, polls, mod actions, anything "on behalf of the channel" |
| Bot user token | Authorization code grant, bot account signs in once | Granting `user:bot`, `user:read:chat`, `user:write:chat`; direct WebSocket |

Don't use the implicit grant on a server. Don't ask users to paste tokens from third-party
token generator sites.

## Scopes

- Ask for the minimum at sign-up; request more later with an "upgrade permissions" flow when the
  user turns on a feature that needs it (predictions, channel points, moderation).
- Store the granted scopes per token (from the validate response) and check before calling an
  endpoint, so you can show "reconnect to enable X" instead of a 401.
- Typical chat bot: bot account `user:bot user:read:chat user:write:chat`; broadcaster
  `channel:bot` (plus feature scopes like `channel:read:redemptions`,
  `channel:manage:predictions`, `moderator:manage:banned_users`).
- Centralize scope lists in one module; scattered string arrays drift.

## OAuth flow hygiene

- `state`: random nonce + timestamp, HMAC-signed (or stored server-side), verified in constant
  time, short expiry (~10 min), single use.
- Exact-match redirect URIs registered per environment.
- After the callback, call `oauth2/validate` and check the token's `user_id` matches the account
  you expected (especially when linking a custom bot account — the wrong person may sign in).

## Refresh

```ts
const inflight = new Map<string, Promise<Tokens>>();

export function refresh(ownerId: string): Promise<Tokens> {
  // single-flight: concurrent callers share one refresh
  let p = inflight.get(ownerId);
  if (!p) {
    p = (async () => {
      const row = await db.tokens.find(ownerId);          // re-read: memory may be stale
      const res = await twitchRefresh(decrypt(row.refresh_token));
      if (res.status === 400 || res.status === 401) {     // invalid refresh token
        await db.tokens.markRevoked(ownerId);
        throw new AuthRevoked(ownerId);
      }
      await db.tokens.save(ownerId, encrypt(res.access_token), encrypt(res.refresh_token), res.expires_in);
      return res;                                         // always persist the NEW refresh token
    })().finally(() => inflight.delete(ownerId));
    inflight.set(ownerId, p);
  }
  return p;
}
```

- Refresh proactively (e.g. at 80 % of `expires_in`) **and** reactively on a 401, retrying the
  original request once.
- Distinguish **transient** failures (network, 5xx, timeout → retry with backoff, keep the
  token) from **permanent** ones (`invalid refresh token` → mark revoked, stop the channel,
  notify the user). Never mark someone revoked because of a timeout.
- In a multi-worker setup the single-flight map becomes a distributed lock (Redis, or a DB row
  lock), or only the leader refreshes.
- Rotating the shared bot/app token must not restart every connection. Existing sessions stay
  valid; only new connections and dropped ones use the new token.

## Validation and revocation

- `GET https://id.twitch.tv/oauth2/validate` on startup and at least hourly for every user token
  in use. Twitch requires this of apps holding user tokens.
- Subscribe to `user.authorization.revoke` (webhook/conduit, app token) for your client ID.
  On receipt: stop the bot for that user, delete their subscriptions, wipe or flag tokens.
- Users can also disconnect via Twitch settings or change their password; both invalidate
  refresh tokens. Your UI should detect `auth_revoked` and offer a one-click reconnect.

## Storing tokens

- Encrypt access and refresh tokens at rest with an AEAD cipher (AES-256-GCM), random 12-byte
  IV per value, and store `version:iv:tag:ciphertext`.
- Derive the key once at boot. If you derive from a passphrase, use a **random per-install salt**
  stored alongside config, not a constant like `"salt"`. Better: generate a 32-byte random key
  and keep it in a secrets manager.
- Include a key **version** prefix so you can rotate: decrypt with the old key, re-encrypt with
  the new, in a background migration.
- Refuse to start in production if the key is missing. Never fall back to another secret: a
  silently different key turns every token into garbage and looks like mass revocation.
- Never log tokens, Authorization headers, or full OAuth callback URLs. Redact in your logger.
