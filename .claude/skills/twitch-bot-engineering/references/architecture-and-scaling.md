# Architecture and scaling

## The process split that works

```
             ┌──────────────┐  DB (source of truth)  ┌──────────────┐
 browser ──▶ │  web / API   │ ◀────────────────────▶ │  bot runtime │ ◀── EventSub (conduit shards)
             │ OAuth, dash  │ ── control API ──────▶ │ chat, jobs   │ ──▶ Helix
             └──────────────┘  (authenticated, local) └──────────────┘
```

- **Web process**: OAuth callbacks, dashboard, public API. Restarts freely.
- **Bot process**: sockets, outbound queues, in-memory caches, scheduled jobs. Restarts are
  expensive, so keep deploys of web-only changes from touching it.
- They share **only** the database and a small **control API** (add/remove channel, send
  message, reload commands, health). No shared memory, no importing each other's singletons.
- Start the control API and health endpoint **before** loading channels, so the dashboard and
  your monitoring work during a slow startup.
- The control API listens on localhost or a private network, requires a shared secret header
  compared in constant time, and refuses to boot without that secret.

## Scaling tiers in detail

### 1–100 channels
- One bot process is plenty. A conduit with one WebSocket shard costs the same effort as
  per-channel sockets and removes the rework later.
- SQLite is fine. Turn on `PRAGMA journal_mode=WAL` and `busy_timeout` (e.g. 5000 ms) as soon as
  two processes open the file.

### 100 – a few thousand channels
- **Conduit with 2+ WebSocket shards.** One app token, one set of subscriptions, Twitch spreads
  events across shards; losing one shard doesn't lose the rest.
- Load channels with bounded concurrency (e.g. 5 at a time), prefetch rows in one query, skip
  disabled channels. Startup should be seconds, not minutes.
- Per-channel state (cooldowns, queues) stays in memory in the single bot process.
- Watch the Helix budget: the app token's bucket is shared by every channel. Cache anything you
  look up repeatedly (user IDs, stream status, game names).
- Consider Postgres once you want a second host, point-in-time restores, or analytics queries
  that shouldn't lock the bot's writes.

### Thousands+ / multi-host
- **Webhook shards** behind a load balancer scale horizontally with no sticky sockets; or run
  many WebSocket shards spread across workers.
- Workers become stateless: dedupe set, cooldowns, outbound rate buckets and locks move to Redis
  (or equivalent). Dedupe keys get a TTL (~10 min is enough).
- Put a queue between "event received" and "command executed" so a slow external API (game
  stats, LLM) never backs up the socket and trips keepalive timeouts.
- Background jobs (token refresh, pollers, reconcilers) need **leader election** or a job lock
  so N workers don't refresh the same token N times.
- Shard by channel ID hash only for your own outbound state; Twitch already distributes inbound.

## Startup and recovery

- **Reconcile, don't recreate.** On boot, list the conduit's subscriptions, diff against what the
  DB says should exist, create only the missing ones, delete only the orphans. A restart should
  create zero subscriptions.
- Restore in-flight state (open stream sessions, active giveaways, pending predictions) from the
  DB before resuming event handling.
- Stagger anything that hits a per-account limit (IRC logins ~20/10 s per account, JOINs) and add
  jitter to all retry timers so a mass disconnect doesn't become a synchronized stampede.
- Keep a per-channel transport switch (e.g. `eventsub` | `irc`) during migrations so you can move
  channels gradually and roll back one channel at a time.

## Data model notes

- Key everything Twitch-facing by **numeric user ID**, never login name — logins can be renamed.
  Store the login as a display/lookup field and refresh it when events show a new one.
- Every column added with `NOT NULL` needs a default or a backfill. Use migrations in production,
  not `sync({ alter: true })`.
- Give each channel a single row that owns its tokens, scopes granted, and an `auth_revoked`
  flag, so the UI can show "reconnect your account" instead of failing silently.
- Plan retention for any per-event history table on day one (raw for N days, then roll up).
  High-volume channels produce millions of rows a month.
- Offer a full data purge per channel (GDPR-style) that also removes its subscriptions.
