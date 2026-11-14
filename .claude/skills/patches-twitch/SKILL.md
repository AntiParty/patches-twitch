---
name: patches-twitch
description: Full development guide for the patches-twitch bot. Use whenever the user asks to add a chat command, modify chat reading (IRC or the EventSub conduit) or Helix sending, touch the BotManager, work with Twitch EventSub, change the Sequelize DB/schema, add a background job, extend the Control API, or debug token refresh / reconnect / message-filter issues in this repo.
---

# patches-twitch development skill

This skill captures the conventions of the `patches-twitch` Twitch bot so changes land in the right place and match existing patterns. Read the relevant section before editing — don't guess file layout. Source code wins if this map has drifted.

## Architecture at a glance

Two Bun/TypeScript processes run side-by-side (see `package.json` scripts `dev:server`, `dev:bot`, `dev:all`):

- `src/index.ts` — web dashboard + public API (Express, sessions; React app in `frontend-react/`, legacy EJS in `frontend/`).
- `src/botService.ts` — chat bot runtime. Exposes a private **Control API** on `http://127.0.0.1:4000` that the web process calls. Every request needs the `x-bot-control-secret` header (`BOT_CONTROL_SECRET`); web callers use `botControlHeaders()` / `botControlUrl` from `src/util/botControl.ts`.

Persistence is Sequelize over SQLite in WAL mode: `data/accounts.sqlite` (`src/db.ts`), `data/metrics.sqlite` (`src/dbMetrics.ts`), plus `src/dbBalance.ts` and `src/dbSessions.ts`. Core models live in `src/db.ts`: `Channel`, `CustomResponse`, `CustomBotAccount`, `StreamSession`, `PeakRank`, `Giveaway`, etc.

The two processes never share memory — they only talk through the DB and the Control API. If you add cross-process behavior, do it via one of those two channels.

## How chat flows

Chat is **read** on one of two transports per channel and always **written** through Helix.

```
IRC socket (util/ircBot.ts)  ─┐
                              ├─> InboundChatMessage -> chat/chatDispatcher.ts -> src/commands/*.ts
EventSub conduit (eventsub/) ─┘                                                     │
                                                    ctx.say -> sendChatMessage -> chatSendLimiter -> POST /helix/chat/messages
```

- `Channel.chat_transport` (`'irc'` default | `'eventsub'`) is the configured transport. `chat/activeTransport.ts` holds the transport that is live right now (in memory); the dispatcher drops messages arriving on the other one, so a message is never handled twice during a switch or fallback.
- Switch a channel with `POST /switch-chat-transport { channel, transport }`. The new transport is activated before the old one is retired (`chat/chatTransportSwitch.ts`).
- Custom bots must be re-linked with `user:read:chat` before their channel can move to `eventsub`.

## Runtime layers (top to bottom)

1. **`botService.ts`** — wiring only. Starts the Control API first, then `loadChatReadinessCache()`, `startConduitRuntime()`, `botManager.loadTokensOnStartup()`, the token refreshers, the cache updater, and restores stream sessions and giveaway redemption subscriptions. Never put business logic here.

2. **`botManager.ts` (singleton `botManager`)** — per-channel lifecycle:
   - `loadChannels` reconciles all conduit channels in one pass (`reconcileConduitChannels`) and starts the rest through `startBotForUser`. Conduit channels whose chat subscription did not come up fall back to IRC.
   - `startBotForUser` gates on `bot_enabled`, picks the default bot or the channel's `CustomBotAccount` (only when `hasCustomBotAccess(channel)`), and calls `chooseChatStart`.
   - `validateToken` / `refreshTokenFunction` / `scheduleTokenRefresh` handle broadcaster OAuth. See "Tokens" below.
   - `loadCommands()` runs once in the constructor and is cached. `botManager.reloadCommands()` hot-reloads; there is no Control API endpoint for it.

3. **`chat/`** — transport-independent chat logic:
   - `chatDispatcher.ts` — parses `!commands`, applies dev-mode silencing, disabled-command settings, cooldowns, troll responses, runs the command and records analytics. It ignores the bot's own messages (`isOwnMessage`) after `observeMessage` has seen them.
   - `dispatchChatMessage.ts` — production wiring of the dispatcher (send credentials, broadcaster lookup, own-message check, elevated-badge tracking for the send limiter).
   - `commandCooldowns.ts`, `chatPresence.ts` (`stopChat`, `isChatActive`), `eventSubChatAdapter.ts` (EventSub event -> IRC-shaped message and tags).

4. **`util/ircBot.ts`** — hand-rolled IRC over **TLS** to `irc.chat.twitch.tv:6697`, one socket per channel:
   - `clients: { [username]: IRCClient }` is the source of truth for IRC connection state. Go through `startChatBot` / `stopChatBot` / `reconnectChatBot` — don't poke `clients` from outside.
   - Logins are rate limited per bot account (`acquireIrcLoginSlot`, 15 per 10s). `startChatBot` resolves to `true` only after the `001` welcome.
   - Heartbeat: `PING` every 60s, tear down after 10min idle. Reconnect: jittered exponential backoff (5s → 5min, max 10 attempts). Each reconnect builds a new client object, so the attempt count is carried in `carriedReconnectAttempts` and reset on `001`.
   - On "Login authentication failed" it tries one token refresh + reconnect (`attemptAuthRecovery`) before alerting; a failed recovery sets `intentionalDisconnect` so there is no reconnect loop.
   - The socket is read-only in practice (`PING/PONG`, `JOIN`, `PART`). Outgoing chat goes through `sendChatMessage()`.

5. **`eventsub/`** — the shared conduit (app token):
   - `conduitRuntime.ts` starts 2 WebSocket shards when `EVENTSUB_CONDUIT_ID` is set (otherwise the runtime is off and every channel uses IRC), routes notifications (chat, stream online/offline, redemptions, `user.authorization.revoke`, `conduit.shard.disabled`), and dedupes by `message_id` across shards.
   - `conduitShard.ts` handles welcome, keepalive watchdog, `session_reconnect` handoff, `revocation`, and backoff.
   - `subscriptionRegistry.ts` owns which subscriptions exist per broadcaster. `conduitOutageMonitor.ts` moves channels to IRC when shards stay down (`EVENTSUB_FALLBACK_AFTER_MS`, default 5 minutes; `0` disables) and back when they recover.
   - `channelEvents` (exported from `conduitRuntime.ts`) is the one entry point for redemption subscribe/unsubscribe and `removeAll`; it picks conduit or per-user socket for you.
   - Per-user sockets (`util/twitchEventSubWs.ts`) still serve stream and redemption events for channels that are not on the conduit.
   - **Dev and prod must use separate conduits.** With `DEV_CHANNELS` set in development, reconcile never deletes subscriptions.

6. **`handlers/commands.ts`** — auto-discovers every file in `src/commands/` that exports `execute`, wraps it in a permission check against `ROLE_HIERARCHY = ["basic user", "tester", "admin", "staff", "owner"]`, and registers the command plus any `aliases`. Duplicate keys across files are dropped with a warning.

7. **Background jobs (`src/jobs/*.ts`)** — `botTokenRefresher`, `customBotTokenRefresher`, `cacheUpdater`, `peakUpdater`, `streamSessionPoller`, `giveawayRedemptionReconciler`, `processMetricsRecorder`, `patchNotesWatcher`.

## Adding a new chat command

1. Create `src/commands/<name>.ts`. The filename (lowercased) becomes the command key, e.g. `ping.ts` → `!ping`.
2. Export `execute` with this signature:
   ```ts
   export async function execute(
     ctx: {
       say: (msg: string, replyToId?: string, bypassFilter?: boolean) => Promise<void>;
       raw: (line: string) => void;   // IRC only; logs a warning on eventsub
       user: string;
       channel: string;
       message: string;
       tags: Record<string, any>;
     },
     channel: string,          // "#channelname"
     message: string,
     tags: Record<string, any>,
     args: string[]
   ): Promise<void>
   ```
3. Optional exports:
   - `export const aliases = ["foo", "bar"]` — extra `!foo`, `!bar` keys. Don't include the main name; it's deduped.
   - `export const minRole = "tester" | "admin" | "staff" | "owner"` — anything not set defaults to `"basic user"`. The wrapper replies "You do not have permission..." automatically.
   - `export const cooldown = { userMs, globalMs }` — overrides the dispatcher's default (10s per user, no global window; 0 disables a window). Mods, VIPs and the broadcaster skip cooldowns.
   - `export const name` / `export const description` — purely informational (used by `!help`).
4. **Always** strip the leading `#` from `channel` before DB lookups: `const sanitizedChannel = channel.replace(/^#/, '')`. `Channel.username` is stored without `#`.
5. Reply via `ctx.say(text, ctx.tags?.["id"])`. Passing the message id makes Twitch render it as a threaded reply. Pass `bypassFilter = true` only for internal/admin messages that should skip `messageFilter`.
6. Commands must work on both transports: use only the tags `eventSubChatAdapter.ts` also provides (`id`, `display-name`, `username`, `user-id`, `room-id`, `badges`, `mod`, `subscriber`, `color`, `tmi-sent-ts`) and avoid `ctx.raw`.
7. Support custom responses with placeholders where it makes sense — mirror `commands/peak.ts`:
   ```ts
   const resp = await getCustomResponse(sanitizedChannel, '<commandName>');
   if (resp) {
     const formatted = resp.replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? '');
     await ctx.say(formatted, messageId);
     return;
   }
   ```
8. Wrap work in `try/catch`, log via `logger.error('[<name>] ...', err)`, and `ctx.say` a short human-readable fallback. Never `throw` — the dispatcher catches it but records it as a failed command.
9. Command analytics (`trackCommandUsage`) and the Prometheus `commandCounter` are handled by the dispatcher. Don't duplicate them.
10. Viewer commands that streamers can turn off are listed in `VIEWER_COMMANDS` (`services/channelCommandSettings.service.ts`); add yours there if it should be toggleable.

Quick skeleton:
```ts
import { Channel, getCustomResponse } from '../db';
import logger from '../util/logger';

export const name = 'example';
export const description = 'One-line description shown in !help';
export const aliases = ['ex'];
// export const minRole = 'tester';

export async function execute(ctx: any, channel: string, message: string, tags: Record<string, any>, args: string[]) {
  const sanitizedChannel = channel.replace(/^#/, '');
  const messageId = ctx.tags?.["id"];
  try {
    // ... do work ...
    await ctx.say(`Result for ${ctx.user}`, messageId);
  } catch (err) {
    logger.error('[example] Error:', err);
    await ctx.say('Something went wrong.', messageId);
  }
}
```

After adding, restart `dev:bot` (it runs with `--watch`).

## Sending messages from non-command code

Use `sendChatMessage(broadcasterId, message, replyParentId?, bypassFilter?, customCredentials?)` from `util/ircBot.ts`. It:
- Sends with the app access token as the default bot (with `for_source_only: true` for Shared Chat), or with a custom bot's user token when `customCredentials` is given.
- Queues through `chatSendLimiter` (`util/chatSendLimiter.ts`): one lane per (broadcaster, sender), 20 messages per 30s (100 when the bot is mod/VIP there), one retry after a 429's `Ratelimit-Reset`, and a dropped message when 30 are already waiting.
- Checks `is_sent` / `drop_reason`, records actionable drops on the channel (`chat_readiness_*`) and alerts Discord.
- Retries once on 401 after fetching a new app access token.
- Runs `messageFilter` (regex + phrase blocklist suppresses; word blocklist redacts) unless `bypassFilter` is true.

From the web process, send via the Control API instead: `POST /send-message { channel, message }`. Omitting `channel` broadcasts to every channel row.

## Tokens

- `Channel.access_token` / `refresh_token` hold an **encrypted envelope** after the first refresh (plaintext only for rows written at login). Always go through `decryptChannelAccessToken(channel)` (or the custom-bot equivalents) before sending a token to Twitch. A `null` result means the envelope could not be decrypted — a server key problem, never a revoked user; do not call Twitch or set `auth_revoked`.
- `TOKEN_ENCRYPTION_KEY` is required in production; there is deliberately no fallback to `SESSION_SECRET`.
- `refreshAccessToken(channel)` re-reads the row from the DB before refreshing — the caller's copy can be stale. Preserve that.
- A channel is marked `auth_revoked` only when Twitch's response says the refresh token is invalid, or on a `user.authorization.revoke` event. Other 400/401 responses are retried with backoff. Keep the channel and custom-bot paths consistent.
- `validateToken` refreshes only on a 401 from `/oauth2/validate`; network errors wait for the next pass. Healthy tokens are validated hourly (Twitch requires it).
- The default bot's user token lives in `process.env.TWITCH_BOT_TOKEN` and is rotated by `util/botAuth.ts` (`refreshBotToken`, single-flight, persisted to `.env` atomically). Rotation does not reconnect live IRC sockets.

## Editing the DB schema

- Models are declared in `src/db.ts` via `class X extends Model` + `X.init({...}, { sequelize, ... })`.
- Don't rely on `sequelize.sync({ alter: true })` for production. New tables are created by `sync()`; new columns need a migration (see `runMigrations` in `src/db.ts` and scripts under `src/scripts/`).
- Field types with `allowNull: false` **must** have a default or an explicit backfill step; older rows will break otherwise.
- `Channel.twitch_user_id` is the canonical key when talking to Twitch APIs; `Channel.username` is the key used everywhere internally (IRC channel name, filesystem paths, etc.).

## Control API — when to add an endpoint

Add to `src/botService.ts` only for operations that must execute **inside the bot process** (touching `botManager`, `clients`, the conduit, EventSub sockets, or in-memory caches). Anything that only reads/writes the DB belongs in the web server routes under `src/routes/`.

Existing endpoints: `/add-channel`, `/remove-channel`, `/reconnect-custom-bot`, `/restart-channel-bot`, `/switch-chat-transport`, `/send-message`, `/pause`, `/resume`, `/health`, `/metrics/chat`, `/metrics/operations`, `/giveaway/redeem/start|stop|pause|reset`.

## Background jobs

New periodic work goes in `src/jobs/<name>.ts`:
- Export a `start<Name>()` function that sets up the interval and returns a stop function (or nothing).
- Call it from `botService.ts` after `dbReady` resolves, or from `BotManager`'s constructor if it's per-channel lifecycle.
- Skip a run when the previous one hasn't finished — see `cacheUpdater.ts` and `startTokenValidationInterval`.
- Give every Twitch HTTP call a timeout, using the constants in `util/httpTimeouts.ts` (`timeout:` for axios, `signal: fetchTimeoutSignal(ms)` for fetch). A timeout is a transient failure: it must never mark a channel revoked, strip premium or tell a streamer to re-authorise.
- Register cleanup with `onShutdown(name, fn)` from `util/processLifecycle.ts`. Never add your own `process.on('SIGINT'|'SIGTERM')` listener: one that does not exit keeps the process alive until pm2 kills it.

## Logging, metrics, tracking

- Use `logger` from `util/logger.ts` (winston) everywhere, not `console.*`. Tag log lines with `[<module>]` prefixes; don't write `[ERROR]` yourself, the level is added for you.
- Extra arguments are printed: `logger.error('[x] failed:', err)` prints the message, `code`, HTTP status and response body, then the stack. Pass the error itself rather than `err.message`.
- Per-cycle and polling lines go at `debug` (`LOG_LEVEL=debug` shows them). Files rotate at 10 MB with 5 kept. The logger is silent under `NODE_ENV=test` unless `TEST_LOGS=1`.
- Never log a raw URL: use `redactUrl()` from `util/logRedaction.ts`, because overlay tokens and OAuth codes travel in query strings.
- Chat message rate: `trackMessageIn()` / `trackMessageOut()` from `util/messageRateTracker.ts`. Already wired in the dispatcher and `sendChatMessage`.
- Operational events (connects, disconnects, recoveries): `recordOperationalEvent` from `services/operationalEvents.service.ts`. Only record a recovery once it actually succeeded.
- `/metrics/operations` exposes connected channels, transports, conduit shard state, send-queue stats, cooldown hits and dispatch errors.
- Prometheus counters live on the web process (`src/server.ts` exports `commandCounter`, `incrementCommandsProcessed`). The bot process imports them directly.

## Tests

- `src/tests/unit/**` and `src/tests/integration/**` run under Mocha + ts-node (`bun run test:unit`, `bun run test:integration`).
- Put pure-logic tests (role checks, filter regex, parsing, dispatcher, cooldowns, limiter, conduit shard) in `unit/`. The chat and conduit modules take their dependencies as arguments so they can be tested without a DB or network — keep new code in that style.
- Put tests that spin up Sequelize / the Control API in `integration/` with a longer timeout.
- Tests set `NODE_ENV=test`. `src/tests/setup.ts` is the shared harness.

## Common gotchas

- **Stale client objects**: `reconnectChatBot` deletes the client and `startChatBot` creates a new one. Never keep state on a captured `client` across a reconnect; `reconnectChatBot` resolves `false` on failure, it does not throw.
- **`clients` map leaks**: every code path that removes a bot must clear `heartbeatInterval`, `reconnectTimeout`, and the map entry. `stopChatBot(intentional=true)` keeps the entry until the `close` event fires.
- **Auth failures must not auto-reconnect**: if you add a new fatal IRC error, set `client.intentionalDisconnect = true` before `socket.destroy()` so `handleReconnect` bails.
- **Stopping chat**: use `botManager.stopBotForUser` / `stopChat` (removes the conduit chat subscription and the IRC client), not `stopChatBot` alone.
- **Ciphertext to Twitch**: sending `channel.access_token` without decrypting gets a 401 that looks like an expired token.
- **Own messages**: the bot receives its own chat lines on both transports. The dispatcher drops them; anything that reads chat outside the dispatcher must do the same.
- **Circular imports**: `ircBot.ts` and `chat/dispatchChatMessage.ts` import each other, and the conduit modules load DB-backed modules lazily. Use those exports inside functions only, never at module top level.
- **Dev-mode silencing**: `devModeChannels` (set by `src/commands/devmode.ts`, state in `util/devModeState.ts`) silences all commands except `!devmode`/`!dev` so a local dev bot can answer instead. Don't work around it — fix the channel state.
- **`DEV_CHANNELS` env var**: in development, `BotManager.getChannels()` filters to a comma-separated allowlist. Useful; don't remove.
- **Custom bot accounts**: gated by `hasCustomBotAccess(channel)` in `chat/customBotAccess.ts`. If you change the gate, update the UI under `src/routes/user/` too.

## Files you'll touch most often

| Change                               | File(s)                                                |
| ------------------------------------ | ------------------------------------------------------ |
| New `!command`                       | `src/commands/<name>.ts`                               |
| Command permission or loader logic   | `src/handlers/commands.ts`                             |
| Command parsing, cooldowns, dispatch | `src/chat/chatDispatcher.ts`, `src/chat/commandCooldowns.ts`, `src/chat/dispatchChatMessage.ts` |
| IRC connect / parse / reconnect      | `src/util/ircBot.ts`                                   |
| Conduit shards / subscriptions / fallback | `src/eventsub/*`                                  |
| Switching or choosing chat transport | `src/chat/chatTransportSwitch.ts`, `src/chat/activeTransport.ts` |
| OAuth / token refresh                | `src/botManager.ts`, `src/util/twitchUtils.ts`, `src/util/botAuth.ts` |
| Helix send / rate limit / filter     | `src/util/ircBot.ts` (`sendChatMessage`), `src/util/chatSendLimiter.ts`, `src/util/messageFilter.ts` |
| Schema / models                      | `src/db.ts` + a script under `src/scripts/`            |
| New periodic job                     | `src/jobs/<name>.ts` + wire in `botService.ts`         |
| Control API endpoint                 | `src/botService.ts`                                    |
| Per-user EventSub socket / handlers  | `src/util/twitchEventSubWs.ts`, `src/handlers/eventsubStatus.ts`, `src/handlers/authorizationRevoke.ts` |
| Dashboard / user-facing route        | `src/routes/user/*`, `src/routes/admin/*`              |

## Before you finish

- Run `bun run build` (tsc) to catch type errors — the project compiles strictly.
- If you changed anything touching chat, tokens, connections, or DB writes: run `bun run test:unit` and, if relevant, `bun run test:integration`.
- Changes to IRC, the conduit or token refresh are not proven by unit tests alone. Run `dev:bot` against a dev channel (with `DEV_CHANNELS` set and the dev conduit) before deploying.
- If you added a command: verify it appears in `!help` output (see `src/commands/help.ts`).
