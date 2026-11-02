# Security checklist

Work through it top to bottom when reviewing a bot. Each line is a yes/no question.

## Secrets and tokens
- [ ] Client secret, encryption key, webhook secret, session secret, control-API secret are
      separate values, each 32+ random bytes, loaded from env/secrets manager, never committed.
- [ ] Boot fails in production when any required secret is missing or weak. No fallbacks
      between secrets.
- [ ] Tokens encrypted at rest with AES-256-GCM, random IV, random salt or raw random key,
      key version prefix, rotation path exists.
- [ ] Logger redacts `Authorization`, `access_token`, `refresh_token`, `code`, `client_secret`.
- [ ] DB files, backups, `.env`, logs and caches are git-ignored; backups are encrypted.

## OAuth
- [ ] Authorization code grant only; `state` signed + expiring + single-use; redirect URIs exact.
- [ ] Token's `user_id` verified after callback; custom-bot linking confirms the expected account.
- [ ] Minimum scopes; feature scopes requested on demand; granted scopes stored and checked.
- [ ] Hourly validation of user tokens; `user.authorization.revoke` handled; revoked users fully
      cleaned up (subscriptions, tokens, running bot).

## EventSub
- [ ] Webhook HMAC verified over raw body with constant-time compare; timestamp age ≤ 10 min;
      message-id replay rejected.
- [ ] Challenge answered as `text/plain`; revocations handled, not ignored.
- [ ] Separate conduits/apps per environment.

## Internal surfaces
- [ ] Control API bound to localhost/private network, secret header compared in constant time,
      refuses to start without the secret.
- [ ] Admin/staff routes behind role checks on the server, not just hidden in the UI.
- [ ] Web dashboard: secure, httpOnly, sameSite session cookies; CSRF tokens on state-changing
      routes; CSP and standard security headers; rate limiting on auth and public APIs.
- [ ] Every route that takes a channel/user ID checks the caller owns or administers it (IDOR).
- [ ] Input validated with a schema (zod or similar) on every API route.

## Chat surface
- [ ] Bot ignores its own messages and other bots; per-user and per-command cooldowns.
- [ ] User input never begins a bot message; output passes a blocklist filter.
- [ ] Custom-command templates use an allowlisted placeholder map; no eval, no user regex
      (ReDoS), length-capped.
- [ ] Privileged commands check the badge/role from the current event.
- [ ] Overlays and Discord relays escape user-provided text for their context (HTML, markdown).

## Supply chain and runtime
- [ ] Lockfile committed; dependency alerts (Dependabot/Renovate) acted on.
- [ ] Process runs as a non-root user; only the web port is public.
- [ ] Data purge per channel on request; retention policy for logs and event history.
- [ ] A `SECURITY.md` with a private reporting route.
