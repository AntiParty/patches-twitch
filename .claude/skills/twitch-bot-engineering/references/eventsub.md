# EventSub

## Transports at a glance

| Transport | Token for subscribing | Good for | Watch out |
|---|---|---|---|
| WebSocket (direct) | **User** token | One channel, desktop tools, prototypes | Tied to one user; small per-connection subscription and cost limits; ~3 connections per user/client |
| Webhook | **App** token | Servers with a public HTTPS endpoint | Must verify HMAC, answer the challenge, respond 2xx fast |
| **Conduit** | **App** token | Multi-channel bots | Shards must stay connected; conduit is deleted ~72 h after all shards go disabled |

A conduit is a container: you create it with an app token, give it N shards (each a WebSocket
session or a webhook URL), then create subscriptions with `transport: { method: "conduit",
conduit_id }`. Subscriptions survive shard reconnects; only the shard → session mapping changes.

## Chat over EventSub

- Subscribe to `channel.chat.message` with `condition: { broadcaster_user_id, user_id: <bot id> }`.
- With an app token (conduit/webhook) this needs `user:read:chat` + `user:bot` granted by the bot
  account, and `channel:bot` granted by the broadcaster **or** the bot being a moderator there.
- Useful siblings: `channel.chat.notification` (subs, raids, announcements),
  `channel.chat.message_delete`, `channel.chat.clear_user_messages`, `stream.online`/`offline`,
  `channel.channel_points_custom_reward_redemption.add`, `user.authorization.revoke`.
- If you translate EventSub chat into an internal "message" shape shared with an IRC path, carry
  over the same fields (badges → mod/subscriber/broadcaster, color, reply parent, message id) so
  commands behave identically on both.

## WebSocket shard lifecycle

1. Connect to `wss://eventsub.wss.twitch.tv/ws`.
2. Receive `session_welcome` → read `session.id` and `keepalive_timeout_seconds`.
3. **Within 10 seconds**, assign the session to the shard (`PATCH /helix/eventsub/conduits/shards`)
   — or for a direct WebSocket, create subscriptions. Otherwise Twitch closes the socket.
4. Reset a timer on every message (notifications and `session_keepalive` both count). If nothing
   arrives within `keepalive_timeout_seconds` + a few seconds grace, treat the socket as dead.
5. `session_reconnect`: open the new `reconnect_url` **before** closing the old socket; keep
   processing on the old one until the new welcome arrives. For a conduit the shard stays
   assigned across this handoff — don't reassign or you'll flap.
6. `revocation`: drop the subscription from your registry/cache and react (e.g. mark the channel
   as needing re-auth, or fall back to another transport). Don't blindly resubscribe.
7. Close codes like 4003 (no subscription/assignment in time), 4004 (reconnect grace expired),
   4007 (invalid reconnect) mean fix the flow, not just retry harder.

Backoff: 1 s doubling to ~30 s, with jitter, reset on a successful welcome.

## Dedupe

Delivery is at least once, and reconnect handoffs overlap. Keep a bounded seen-set of
`metadata.message_id` (LRU of ~1000 in-process, or Redis `SET key NX EX 600` across workers) and
**share it across all shards** — duplicates often arrive on a different shard than the original.

## Webhooks

```ts
// Verify BEFORE parsing JSON; you need the raw body bytes.
const id = req.header('Twitch-Eventsub-Message-Id')!;
const ts = req.header('Twitch-Eventsub-Message-Timestamp')!;
const sig = req.header('Twitch-Eventsub-Message-Signature')!; // "sha256=<hex>"
const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(id + ts + rawBody).digest('hex');
const ok = sig.length === expected.length &&
  crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
if (!ok || Date.now() - Date.parse(ts) > 10 * 60_000) return res.sendStatus(403);
if (seen(id)) return res.sendStatus(204);                         // replay / duplicate

switch (req.header('Twitch-Eventsub-Message-Type')) {
  case 'webhook_callback_verification':
    return res.type('text/plain').send(JSON.parse(rawBody).challenge);
  case 'revocation':  enqueueRevocation(JSON.parse(rawBody)); return res.sendStatus(204);
  case 'notification': enqueue(JSON.parse(rawBody));          return res.sendStatus(204);
}
```

- Respond in well under a few seconds; do the work off a queue. Slow or failing endpoints get
  their subscriptions revoked (`notification_failures_exceeded`).
- Secret: 10–100 random chars, per environment.

## Subscription registry

- Keep a cache of `{type, condition} → subscription id, status`. Populate it from
  `GET /helix/eventsub/subscriptions` at boot and after any outage, since revocations can be missed
  while disconnected.
- Treat `409 already exists` as success. Make "ensure subscribed" idempotent.
- When a channel leaves (unlink, disable, revoke), delete **all** of its subscriptions.
- Separate conduits (and ideally separate Twitch apps) for dev and prod. A dev process assigning
  its socket to the prod conduit's shard steals production traffic.

## Outage fallback (optional)

If you keep IRC as a fallback: after the conduit has been down for a configured time, start IRC
readers for affected channels, keep stream/redemption events single-sourced so nothing fires
twice, and on recovery switch back only channels that still have a healthy chat subscription.
Test it by pointing the EventSub URL at a local relay you can kill — blocking DNS doesn't drop
already-open sockets.
