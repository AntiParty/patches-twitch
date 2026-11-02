# Chat in and out

## Sending

`POST https://api.twitch.tv/helix/chat/messages`

```json
{ "broadcaster_id": "123", "sender_id": "<bot id>", "message": "hi",
  "reply_parent_message_id": "<optional>", "for_source_only": true }
```

- With an app token and the `user:bot` / `channel:bot` grants, the message shows the **chat bot
  badge**. With the bot's user token (`user:write:chat`) it works but without the badge.
- Response `data[0]`: `is_sent` and `drop_reason { code, message }`. Common reasons: AutoMod held
  it, `msg_duplicate` (identical message within ~30 s), `msg_ratelimit`, channel followers/sub-only
  mode, banned. Log every drop with the code; alert the streamer for actionable ones (bot banned,
  missing permission) with a cooldown so you don't spam them.
- Max 500 characters. Truncate on a word boundary; split long output deliberately or link out.
- `for_source_only: true` keeps replies in the channel the command came from during **shared
  chat** sessions instead of broadcasting into partner channels.
- Replies: pass the incoming message id as `reply_parent_message_id` for threaded replies.

## Rate limits (keep them in config)

| Limit | Rough value | Applies to |
|---|---|---|
| Chat messages, bot is not mod/VIP/broadcaster | 20 per 30 s per channel | Sends |
| Chat messages, bot is mod/VIP/broadcaster | 100 per 30 s per channel | Sends |
| Channel slow mode | as set by channel | Sends (mods exempt) |
| Helix API | token bucket, ~800 points/min per client+token, see `Ratelimit-*` headers | All Helix calls |
| IRC auth / JOIN (legacy) | ~20 per 10 s per account | IRC only |

Outbound queue per channel:

```ts
class ChannelQueue {
  private tokens: number; private last = Date.now(); private q: Job[] = []; private draining = false;
  constructor(private capacity: number, private perMs: number) { this.tokens = capacity; }
  push(job: Job) { if (this.q.length > 50) return; this.q.push(job); void this.drain(); } // shed load
  private refill() {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / this.perMs) * this.capacity);
    this.last = now;
  }
  private async drain() {
    if (this.draining) return;                       // one drainer per channel, sends stay ordered
    this.draining = true;
    try {
      this.refill();
      while (this.q.length && this.tokens >= 1) { this.tokens--; await send(this.q.shift()!); this.refill(); }
    } finally { this.draining = false; }
    if (this.q.length) setTimeout(() => void this.drain(), this.perMs / this.capacity);
  }
}
// capacity 20 / perMs 30_000 normally; raise to 100 when the bot is a mod in that channel.
```

On HTTP `429`, pause that bucket until `Ratelimit-Reset` (epoch seconds) and retry once.
Shed or coalesce low-value messages (e.g. "X entered the giveaway") when the queue is long —
raids and hype trains are exactly when queues explode.

## Receiving and dispatching commands

Pipeline for every inbound message:

1. **Dedupe** by message id.
2. **Drop** messages from the bot itself and from known bots (configurable ignore list).
3. **Parse**: prefix + command + args. Normalize case, strip zero-width/invisible chars, ignore
   anything after the first ~200 chars for parsing.
4. **Resolve**: per-channel disabled commands, custom commands, aliases.
5. **Authorize**: role from badges (broadcaster > mod > VIP > subscriber > everyone) plus your own
   app roles. Use the badges in the event, not a cached guess.
6. **Cooldowns**: global per-command-per-channel (e.g. 5 s) **and** per-user (e.g. 15 s). Mods
   and broadcaster may bypass. Silently ignore while cooling down; don't reply "on cooldown".
7. **Execute** with a timeout. Slow external calls (stats APIs, LLMs) run off the socket path.
8. **Reply** via the outbound queue.
9. **Record** usage metrics once, centrally, not inside each command.

Command module contract (one file per command, auto-discovered):

```ts
export const name = 'rank';
export const aliases = ['elo'];
export const minRole = 'everyone';      // everyone | subscriber | vip | mod | broadcaster | owner
export const cooldown = { userMs: 15_000, globalMs: 3_000 };
export async function execute(ctx: CommandContext, args: string[]): Promise<void> { /* ... */ }
```

- Commands never throw to the dispatcher; catch, log with a module tag, reply with a short
  human message.
- Custom responses with `{placeholders}`: substitute from an allowlisted variable map only. No
  template engines, no `eval`, no user-supplied regex.

## Output safety

- Never start a reply with user-controlled text: prefix with your own words so a user can't make
  the bot emit `!command` (triggering other bots or your own loop) or `/me`-style actions.
- Strip or neutralize `@everyone`-style pings and links in echoed user input, and pass output
  through a per-channel blocklist (phrase/regex → suppress, word → redact). Banned output should
  be suppressed, logged and surfaced to staff, not sent "with asterisks" by default.
- Don't echo display names or user text into other systems (Discord webhooks, HTML overlays)
  without escaping for that system.
- Rate-limit features that cause the bot to talk unprompted (timers, alerts, reminders) per
  channel, and let streamers turn each one off.

## Legacy IRC notes (only if you keep it)

- Request `twitch.tv/tags twitch.tv/commands` caps; parse tags with escaping (`\s`, `\:`, `\\`).
- **Buffer partial lines** across TCP chunks; split on `\r\n` only on the accumulated buffer.
- Answer `PING` with `PONG`; treat no traffic for a few minutes as a dead socket.
- `RECONNECT` from the server means reconnect now; `NOTICE` with `msg_banned` / login failure
  means stop, don't retry.
- Send over Helix even when reading over IRC.
