# Operations

## Health and metrics

Expose from the bot process (behind the control-API secret or on a private port):

- `/health`: DB reachable, conduit shards assigned (`a/N`), channels running vs expected,
  token refresher last success, queue depths. Return 503 when degraded so monitors catch it.
- Counters/gauges worth having: messages in/out per minute, drops by `drop_reason`, Helix 429s,
  EventSub reconnects per shard, duplicate events dropped, token refresh success/transient/
  permanent, command latency p50/p95, event-loop lag, RSS.
- A `!ping` / `!status` style command for mods that reports transport and shard state is cheap
  and saves a lot of "is the bot down?" messages.

## Alerts (route to Discord/Slack/pager with cooldowns)

- All shards unassigned for > 1 min, or the conduit missing.
- Shared bot/app token refresh failing.
- Spike in permanent refresh failures (often a key/config mistake, not users leaving).
- Spike in `drop_reason` for one channel (bot banned, lost mod, AutoMod).
- Event-loop lag or memory growth (leaked timers on reconnect are the usual cause).

## Leaks to look for

Every place that stops a channel must clear: its heartbeat/keepalive timer, reconnect timer,
outbound queue timer, map entries, and subscriptions. Write a test that starts and stops a channel
1000 times and asserts timer and map counts return to zero.

## Deploys

- Web and bot deploy independently; bot deploys are graceful: stop accepting new work, drain
  outbound queues, close sockets cleanly, exit. Conduit subscriptions survive the gap; reconcile
  on boot.
- Run schema migrations before starting the new bot version, and make them backwards compatible
  for one release so you can roll back.
- Keep dev and prod fully separate: Twitch app (client ID), conduit, webhook secret, DB, and a
  dev channel allowlist. Add a per-channel "dev mode" switch so prod stays silent in a channel
  while you test the dev build there.

## Testing

- Unit-test pure logic: parsers (IRC tags, line buffering), permission checks, cooldowns, filter
  rules, refresh policy (transient vs permanent), dedupe, backoff.
- Inject sockets, timers and HTTP clients so shard lifecycle (welcome → assign → keepalive
  timeout → reconnect → revocation) can be tested without Twitch.
- The Twitch CLI (`twitch event trigger`, `twitch event websocket start-server`) emits mock
  EventSub events for webhook and WebSocket handlers.
- Live checks before a rollout: a restart that recreates zero subscriptions, a forced shard
  disconnect, a token refresh of the shared bot token with channels connected, sending into a
  channel where the bot isn't a mod (20/30 s limit), and an unlink that removes all subscriptions.
