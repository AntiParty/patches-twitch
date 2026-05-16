---
name: patches-twitch
description: Full development guide for the patches-twitch bot. Use whenever the user asks to add a chat command, modify the IRC/Helix layer, touch the BotManager, work with Twitch EventSub, change the Sequelize DB/schema, add a background job, extend the Control API, or debug token refresh / reconnect / message-filter issues in this repo.
---

# patches-twitch development skill

This skill captures the conventions of the `patches-twitch` Twitch bot so changes land in the right place and match existing patterns. Read the relevant section before editing — don't guess file layout.

## Architecture at a glance

Two Bun/TypeScript processes run side-by-side (see `package.json` scripts `dev:server`, `dev:bot`, `dev:all`):

- `src/index.ts` — web dashboard + public API (Express, EJS, sessions).
- `src/botService.ts` — chat bot runtime. Exposes a private **Control API** on `http://localhost:4000` that the web process calls to add/remove channels, send messages, pause/resume, check `/health`, and read `/metrics/chat`.

Persistence is Sequelize over SQLite (`data/accounts.sqlite`, forced regardless of `NODE_ENV`). Models live in `src/db.ts`: `Channel`, `CustomResponse`, `CustomBotAccount`, `StreamSession`, `PeakRank`, etc.

The two processes never share memory — they only talk through the DB and the Control API. If you add cross-process behavior, do it via one of those two channels.

## Runtime layers (top to bottom)

1. **`botService.ts`** — boots `botManager.loadTokensOnStartup()`, starts background jobs (`startBotTokenAutoRefresher`, `startCacheUpdater`, `startStreamSessionPolling`), restores in-flight `StreamSession` rows into memory, then starts the Control API. Never put business logic here; it's just wiring.

2. **`botManager.ts` (singleton `botManager`)** — owns per-channel lifecycle:
   - `startBotForUser` gates on `bot_enabled` + role/subscription, picks between the default bot and a per-channel `CustomBotAccount`, then calls `startChatBot` and `addUserSubscription` (EventSub).
   - `validateToken` / `refreshTokenFunction` / `scheduleTokenRefresh` handle OAuth. Always re-read the channel row from the DB before refreshing — the in-memory `refreshToken` param can be stale.
   - `loadCommands()` is called **once** in the constructor and cached. Call `botManager.reloadCommands()` if you want to hot-reload.

3. **`util/ircBot.ts`** — hand-rolled IRC over raw `net.Socket` to `irc.chat.twitch.tv:6667`. Key invariants:
   - `clients: { [username]: IRCClient }` is the source of truth for connection state. Always go through `startChatBot` / `stopChatBot` / `reconnectChatBot` — don't poke `clients` directly from outside this file.
   - Every client has a heartbeat (`PING` every 60s, tear down after 10min idle) and exponential-backoff reconnect (5s → 5min, max 10 attempts). Auth failures set `intentionalDisconnect = true` so we don't reconnect in a loop.
   - Incoming line parser expects IRCv3 tags (`CAP REQ :twitch.tv/tags` is sent on connect). Tags are split on `;` into a plain object; `id` is aliased to `message-id`.
   - Outgoing chat does **not** go over IRC. It goes through `sendChatMessage()` → `POST https://api.twitch.tv/helix/chat/messages` so Twitch shows the chat-bot badge. The IRC socket is read-only in practice (apart from `PING/PONG`, `JOIN`, `PART`).

4. **`handlers/commands.ts`** — auto-discovers every file in `src/commands/` that exports `execute`, wraps it in a permission check against `ROLE_HIERARCHY = ["basic user", "tester", "admin", "staff", "owner"]`, and registers the command plus any `aliases`. Duplicate keys across files are dropped with a warning.

5. **`src/commands/*.ts`** — one command per file. See "Adding a command" below for the exact contract.

6. **Background jobs (`src/jobs/*.ts`)** — `botTokenRefresher`, `cacheUpdater`, `peakUpdater`, `streamSessionPoller`. Each exports a `start*` function called from `botService.ts` or `BotManager`.

7. **EventSub (`util/twitchEventSubWs.ts`)** — per-user WebSocket subscriptions (`addUserSubscription(twitchUserId, accessToken, broadcasterId)` / `removeUserWebSocket(twitchUserId)`). Handlers live in `handlers/eventsubStatus.ts`.

## Adding a new chat command

1. Create `src/commands/<name>.ts`. The filename (lowercased) becomes the command key, e.g. `ping.ts` → `!ping`.
2. Export `execute` with this signature:
   ```ts
   export async function execute(
     ctx: {
       say: (msg: string, replyToId?: string, bypassFilter?: boolean) => Promise<void>;
       raw: (line: string) => void;
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
   - `export const name` / `export const description` — purely informational (used by `!help`).
4. **Always** strip the leading `#` from `channel` before DB lookups: `const sanitizedChannel = channel.replace(/^#/, '')`. `Channel.username` is stored without `#`.
5. Reply via `ctx.say(text, ctx.tags?.["id"])`. Passing the message id makes Twitch render it as a threaded reply. Pass `bypassFilter = true` only for internal/admin messages that should skip `messageFilter`.
6. Support custom responses with placeholders where it makes sense — mirror `commands/peak.ts`:
   ```ts
   const resp = await getCustomResponse(sanitizedChannel, '<commandName>');
   if (resp) {
     const formatted = resp.replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? '');
     await ctx.say(formatted, messageId);
     return;
   }
   ```
7. Wrap work in `try/catch`, log via `logger.error('[<name>] ...', err)`, and `ctx.say` a short human-readable fallback. Never `throw` — it'll be caught by the wrapper but surfaces as analytics failures.
8. Command analytics (`trackCommandUsage`) and the Prometheus `commandCounter` are handled by the IRC layer. Don't duplicate them.

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

After adding, either restart `dev:bot` or `POST http://localhost:4000/reload-commands` if that endpoint exists; otherwise call `botManager.reloadCommands()` from a REPL.

## Editing the DB schema

- Models are declared in `src/db.ts` via `class X extends Model` + `X.init({...}, { sequelize, ... })`.
- Don't rely on `sequelize.sync({ alter: true })` for production — add a migration script under `src/scripts/` (see `migrateDb.ts`, `migrate_overlay.ts` as references) and run it manually.
- Field types with `allowNull: false` **must** have a default or an explicit backfill step; older rows will break otherwise.
- `Channel.twitch_user_id` is the canonical key when talking to Twitch APIs; `Channel.username` is the key used everywhere internally (IRC channel name, filesystem paths, etc.).

## Sending messages from non-command code

Use `sendChatMessage(broadcasterId, message, replyParentId?, bypassFilter?, customCredentials?)` from `util/ircBot.ts`. It:
- Auto-retries once on 401 after re-fetching an app access token via `twitchUtils.refreshToken`.
- Runs `messageFilter` (regex + phrase blocklist suppresses; word blocklist redacts) unless `bypassFilter` is true. Suppression emits a Discord warning via `handlers/discordHandler.sendWarningToDiscord`.
- Calls `trackMessageOut()` for the `/metrics/chat` graph.

From the web process, send via the Control API instead: `POST http://localhost:4000/send-message { channel, message }`.

## Control API — when to add an endpoint

Add to `src/botService.ts` only for operations that must execute **inside the bot process** (touching `botManager`, `clients`, EventSub sockets, or in-memory caches). Anything that only reads/writes the DB belongs in the web server routes under `src/routes/`.

Existing endpoints: `/add-channel`, `/remove-channel`, `/reconnect-custom-bot`, `/send-message`, `/pause`, `/resume`, `/health`, `/metrics/chat`.

## Background jobs

New periodic work goes in `src/jobs/<name>.ts`:
- Export a `start<Name>()` function that sets up the interval/cron and returns nothing (or a handle for tests).
- Call it from `botService.ts` after `dbReady` resolves, or from `BotManager`'s constructor if it's per-channel lifecycle.
- Use `setInterval` with sane guards (skip runs if the previous one hasn't finished — see `cacheUpdater.ts`).

## Logging, metrics, tracking

- Use `logger` from `util/logger.ts` (winston) everywhere. Tag log lines with `[<module>]` prefixes — it's how existing grep/filter conventions work.
- Chat message rate: `trackMessageIn()` / `trackMessageOut()` from `util/messageRateTracker.ts`. Already wired in IRC handler and `sendChatMessage`.
- Command analytics: already wired; don't call `trackCommandUsage` manually from commands.
- Prometheus counters live on the web process (`src/server.ts` exports `commandCounter`, `incrementCommandsProcessed`). The bot process imports them directly, which works because they're plain JS objects — don't turn them into singletons that assume a specific event loop.

## Tests

- `src/tests/unit/**` and `src/tests/integration/**` run under Mocha + ts-node.
- Put pure-logic tests (role checks, filter regex, parsing) in `unit/`.
- Put tests that spin up Sequelize / the Control API in `integration/` with a longer timeout.
- Tests set `NODE_ENV=test`. `src/tests/setup.ts` is the shared harness.

## Common gotchas

- **Race on token refresh**: `BotManager.refreshTokenFunction` re-reads the channel from the DB for a reason — the `refreshToken` argument can be stale if another refresh just ran. Preserve that pattern.
- **`clients` map leaks**: Every code path that removes a bot must clear `heartbeatInterval`, `reconnectTimeout`, and the map entry. `stopChatBot(intentional=true)` keeps the entry around until the `close` event fires; be aware when writing reconnection logic.
- **Auth failures must not auto-reconnect**: If you add a new fatal IRC error, set `client.intentionalDisconnect = true` before `socket.destroy()` so `handleReconnect` bails.
- **Dev-mode silencing**: `devModeChannels` (set in `src/commands/devmode.ts`) silences all commands except `!devmode`/`!dev` when `NODE_ENV !== 'development'`. Don't work around it — fix the channel state.
- **`DEV_CHANNELS` env var**: In development, `BotManager.getChannels()` filters to a comma-separated allowlist. Useful; don't remove.
- **Custom bot accounts**: Gated on `channel.has_subscription || role ∈ {tester, Staff, admin}`. If you change the gate, update both `botManager.startBotForUser` and any UI under `src/routes/user/`.

## Files you'll touch most often

| Change                               | File(s)                                                |
| ------------------------------------ | ------------------------------------------------------ |
| New `!command`                       | `src/commands/<name>.ts`                               |
| Command permission or loader logic   | `src/handlers/commands.ts`                             |
| IRC connect / parse / reconnect      | `src/util/ircBot.ts`                                   |
| OAuth / token refresh                | `src/botManager.ts`, `src/util/twitchUtils.ts`         |
| Helix send / message filter          | `src/util/ircBot.ts` (`sendChatMessage`), `src/util/messageFilter.ts` |
| Schema / models                      | `src/db.ts` + a script under `src/scripts/`            |
| New periodic job                     | `src/jobs/<name>.ts` + wire in `botService.ts`         |
| Control API endpoint                 | `src/botService.ts`                                    |
| EventSub subscription / handler      | `src/util/twitchEventSubWs.ts`, `src/handlers/eventsubStatus.ts` |
| Dashboard / user-facing route        | `src/routes/user/*`, `src/routes/admin/*`              |

## Before you finish

- Run `bun run build` (tsc) to catch type errors — the project compiles strictly.
- If you changed anything touching tokens, connections, or DB writes: run `bun run test:unit` and, if relevant, `bun run test:integration`.
- If you added a command: verify it appears in `!help` output (see `src/commands/help.ts`) and that `trackCommandUsage` records at least one row after a manual invocation.
