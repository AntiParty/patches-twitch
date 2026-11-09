# Bot and chat

## Bot lifecycle

`src/botManager.ts` owns the per-channel lifecycle and caches the command handler.

- `loadChannels` reconciles every conduit channel in one pass and starts the rest through `startBotForUser`.
- `startBotForUser` selects the default bot or an active `CustomBotAccount` (gated by `hasCustomBotAccess`) and brings chat up on the channel's transport through `chooseChatStart`.
- `stopBotForUser` (which calls `stopChat`), restart helpers, `switchChatTransport`, and `reloadCommands` are the supported lifecycle paths.
- Token work must re-read current persisted credentials when races are possible.
- `DEV_CHANNELS` limits development connections; preserve that safety boundary.

`src/botService.ts` wires startup, restores durable state, starts refresh/cache jobs, and exposes bot-process operations. Keep domain logic out of it.

## Chat in: IRC or the EventSub conduit

Each channel reads chat on one transport: `Channel.chat_transport` is `'irc'` (default) or `'eventsub'`. Both feed the same dispatcher.

- `src/chat/chatDispatcher.ts` parses commands, applies dev-mode silencing, disabled-command settings and cooldowns, runs the command, and records analytics. It ignores the bot's own messages and messages from the transport that is not active (`src/chat/activeTransport.ts`).
- `src/chat/dispatchChatMessage.ts` is the production wiring; `src/chat/eventSubChatAdapter.ts` converts EventSub chat events to the IRC-shaped message and tags commands expect.
- `src/eventsub/` owns the conduit: `conduitRuntime.ts` (2 shards, notification routing, cross-shard dedupe; off unless `EVENTSUB_CONDUIT_ID` is set), `conduitShard.ts` (welcome, keepalive, reconnect handoff, revocation), `subscriptionRegistry.ts`, and `conduitOutageMonitor.ts` (falls back to IRC after `EVENTSUB_FALLBACK_AFTER_MS`).
- Use `channelEvents` from `conduitRuntime.ts` for redemption subscriptions and channel removal; it picks the conduit or the per-user socket.
- Dev and prod must use separate conduits. `POST /switch-chat-transport` moves one channel; the new transport is activated before the old one is retired.

## IRC and Helix

`src/util/ircBot.ts` owns the `clients` map, connection guards, heartbeat, reconnect backoff, IRCv3 parsing, and `sendChatMessage`.

- IRC connects over TLS (`irc.chat.twitch.tv:6697`), one socket per channel, with logins rate limited per bot account.
- Each reconnect builds a new client object; the attempt count is carried separately and reset on the `001` welcome. `reconnectChatBot` resolves `false` on failure rather than throwing.
- Outgoing messages use `POST /helix/chat/messages` so the chat-bot identity/badge is correct, queued per channel by `src/util/chatSendLimiter.ts` (20 per 30s, 100 when the bot is mod/VIP, one retry after a 429).
- Check `is_sent` / `drop_reason`; a 200 is not a delivered message.
- Preserve `for_source_only` behavior for shared-chat replies.
- Shared-chat messages from another source room are filtered before command execution.
- Reply selection and recent-message targeting helpers live in `src/util/chatReplyTargets.ts`.
- Message filtering lives in `src/util/messageFilter.ts`; bypass it only for deliberate trusted/admin output.
- Every removal/restart path must clear heartbeats, reconnect timeouts, connection guards, and stale `clients` entries.
- Fatal auth failures must suppress automatic reconnect loops.

## Commands

`src/handlers/commands.ts` discovers `.ts`/`.js` files in `src/commands/` that export `execute`. The filename becomes the main `!command`; optional `aliases` add keys and optional `minRole` uses the role hierarchy.

Use the established command signature:

```ts
export async function execute(
  ctx: {
    say: (message: string, replyToId?: string, bypassFilter?: boolean) => Promise<void>;
    raw: (line: string) => void;
    user: string;
    channel: string;
    message: string;
    tags?: Record<string, any>;
  },
  channel: string,
  message: string,
  tags: Record<string, any>,
  args: string[],
): Promise<void>
```

Command rules:

- Normalize DB channel keys with `channel.replace(/^#/, "")`.
- Reply with `ctx.say(text, ctx.tags?.["id"])` when a threaded reply is appropriate.
- Put reusable parsing or domain behavior in `src/services/`, `src/models/`, or a focused utility and unit-test it.
- Use `getCustomResponse` only where the feature supports channel-configurable output.
- Log failures with `src/util/logger.ts` and return a short viewer-safe response.
- Command analytics and message-rate tracking are already wired in the chat layer.
- If `!help` visibility changes, inspect `src/commands/help.ts`; it maintains an explicit hidden-command set.

## Control API

Bot-only endpoints live in `src/botService.ts` and bind to `127.0.0.1:4000`. All endpoints, including health and metrics, pass through shared-secret authentication.

Web callers must use:

```ts
import { botControlHeaders, botControlUrl } from "@/util/botControl";
```

Add an endpoint only when work must execute in bot-process memory: `botManager`, IRC clients, EventSub sockets, or bot-local state. Pure DB work belongs in a service/Express route.

## EventSub, OAuth, and custom bots

- WebSocket subscription transport: `src/util/twitchEventSubWs.ts`
- Event handling: `src/handlers/eventsubStatus.ts`
- OAuth/API helpers and encrypted token access: `src/util/twitchUtils.ts`, `src/util/crypto.ts`
- Bot token selection/normalization: `src/util/botAuth.ts`
- Scope definitions: `src/util/twitchScopes.ts`
- Default token refresh: `src/jobs/botTokenRefresher.ts`
- Per-channel custom-bot refresh: `src/jobs/customBotTokenRefresher.ts`

Token rules:

- `Channel.access_token` / `refresh_token` are encrypted envelopes after the first refresh. Decrypt with `decryptChannelAccessToken` before sending to Twitch; a `null` result is a server key problem, not a revoked user.
- Mark a channel `auth_revoked` only when Twitch says the refresh token is invalid or on `user.authorization.revoke` (`src/handlers/authorizationRevoke.ts`). Retry other 400/401 responses.
- `validateToken` refreshes only on a 401; healthy tokens are validated hourly.

Scope or token changes usually require coordinated updates across auth URL generation, callback persistence, runtime consumption, refresh behavior, and tests.
