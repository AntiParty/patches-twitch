---
name: twitch-bot-engineering
description: Use when building, reviewing, scaling or hardening a Twitch chat bot or Twitch-integrated service - reading or sending chat, IRC vs EventSub, conduits and shards, Helix API calls, OAuth scopes and token refresh, rate limits (429, msg_ratelimit, join limits), reconnect storms, duplicate events, revoked tokens, multi-channel bots growing from tens to thousands of channels, or a security review of one.
---

# Twitch bot engineering

## Overview

A Twitch bot is a long-running, multi-tenant client of three Twitch surfaces:
**EventSub** (events in), **Helix** (actions out) and **OAuth** (whose identity, with what scopes).
Almost every production incident comes from one of four things: a token, a rate limit,
a reconnect, or a duplicated/missed event. Design for those first; commands are the easy part.

**Core principle:** read with EventSub, write with Helix, keep every token in one
refresh pipeline, and put a limiter in front of every Twitch call.

## Decide the shape first

| Channels you serve | Read chat via | Run as | Store |
|---|---|---|---|
| 1 (your own) | EventSub WebSocket, user token | one process | file / SQLite |
| 2 – ~100 | EventSub WebSocket **or** a conduit with 1 WebSocket shard | one bot process + web process | SQLite in WAL mode |
| ~100 – few thousand | **Conduit** (app token), 2+ WebSocket shards | bot process(es) + web + control API | Postgres (or SQLite on one host) |
| thousands+ / multi-host | Conduit with **webhook** shards behind a load balancer, or many WS shards spread over workers | stateless workers + queue | Postgres + Redis (dedupe, cooldowns, locks) |

IRC (`irc.chat.twitch.tv`) still works but is the legacy path: login and JOIN limits make
startup slow as channels grow, and messages sent over IRC don't get the chat-bot badge.
Start on EventSub; keep IRC only as an outage fallback if you need one.

Details and the reasons behind each tier: `references/architecture-and-scaling.md`.

## Non-negotiables

1. **Send chat with Helix** `POST /helix/chat/messages` using an app token, with `user:bot`
   on the bot account and `channel:bot` from the broadcaster (or the bot is a mod). Check
   `is_sent` and `drop_reason` on every response; a 200 is not "delivered".
2. **One outbound queue per channel** that enforces Twitch's chat limits and honours
   `429` + `Ratelimit-Reset`. Never `await say()` in a loop without it.
3. **Dedupe every EventSub message by `message_id`** (at-least-once delivery), with the
   seen-set shared across all shards/workers.
4. **Handle `session_reconnect`, `revocation` and keepalive timeouts** explicitly.
   Reconnect with jittered exponential backoff; never reconnect on an auth failure.
5. **Single-flight token refresh**: one refresh per token at a time, re-read the latest
   refresh token from storage before refreshing, persist the new pair atomically.
6. **Validate user tokens** on startup and hourly (`GET id.twitch.tv/oauth2/validate`) —
   Twitch requires it — and subscribe to `user.authorization.revoke` so you clean up the
   moment someone disconnects your app.
7. **Encrypt tokens at rest**, request the fewest scopes, verify webhook signatures
   with a constant-time compare, sign/verify OAuth `state`.
8. **Ignore your own messages and other bots**, add per-user and per-command cooldowns,
   and never let user input start your reply (no loops, no command injection into other bots).

## Reference files

| Read when | File |
|---|---|
| Picking architecture, splitting processes, scaling, startup time, DB choice | `references/architecture-and-scaling.md` |
| EventSub WebSocket, conduits, shards, webhooks, dedupe, reconnect, revocation | `references/eventsub.md` |
| OAuth flows, scopes, app vs user tokens, refresh, validation, revocation | `references/auth-and-tokens.md` |
| Sending chat, rate limits, commands, cooldowns, shared chat, filtering output | `references/chat-io.md` |
| Security review or hardening checklist | `references/security-checklist.md` |
| Health checks, metrics, alerts, deploys, testing against live Twitch | `references/operations.md` |

Twitch limits change. Numbers in these files were right as of late 2026; confirm against
dev.twitch.tv docs before hard-coding a new one, and keep limits in config, not literals.

## Common mistakes

| Mistake | What happens | Fix |
|---|---|---|
| Rotating the shared bot token tears down every connection | Reconnect storm, login rate limit, mass auth failures | Keep live connections on the old session; only re-auth sockets that actually dropped, staggered |
| Refreshing a token from a stale in-memory copy | Twitch invalidates the chain; user looks "revoked" | Re-read from DB inside a per-token lock |
| Encryption key falls back to another secret when unset | Every stored token decrypts to garbage after a config change | Fail fast at boot if the key is missing; version the key |
| Splitting TCP data on `\r\n` per chunk | Messages split across packets are silently dropped | Buffer partial lines across chunks |
| One socket per channel | Startup takes minutes, limits hit, many reconnect loops | Conduit + shards |
| No outbound limiter | `msg_ratelimit` drops, Helix 429s, bot looks dead during raids | Per-channel token bucket + retry after reset |
| Per-shard dedupe | Same event processed twice during reconnect handoff | Dedupe store shared across shards |
| Replying in shared chat without `for_source_only` | Bot answers in partner channels too | Set `for_source_only: true` |
| Two processes on one SQLite file without WAL | Second process blocks at boot | `journal_mode=WAL`, `busy_timeout` |
| Testing locally on production channels | Users see dev replies | Separate dev app/conduit + channel allowlist or a dev-mode switch |
