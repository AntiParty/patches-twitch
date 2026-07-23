# Bot and chat

## Bot lifecycle

`src/botManager.ts` owns the per-channel lifecycle and caches the command handler.

- `startBotForUser` selects the default bot or an active `CustomBotAccount`, starts IRC, and establishes EventSub.
- `stopBotForUser`, restart helpers, and `reloadCommands` are the supported lifecycle paths.
- Token work must re-read current persisted credentials when races are possible.
- `DEV_CHANNELS` limits development connections; preserve that safety boundary.

`src/botService.ts` wires startup, restores durable state, starts refresh/cache jobs, and exposes bot-process operations. Keep domain logic out of it.

## IRC in, Helix out

`src/util/ircBot.ts` owns the `clients` map, connection guards, heartbeat, reconnect backoff, IRCv3 parsing, command dispatch, and `sendChatMessage`.

- Incoming messages arrive over a raw IRC socket.
- Outgoing messages use `POST /helix/chat/messages` so the chat-bot identity/badge is correct.
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

Scope or token changes usually require coordinated updates across auth URL generation, callback persistence, runtime consumption, refresh behavior, and tests.
