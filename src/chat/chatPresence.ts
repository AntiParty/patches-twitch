import logger from '../util/logger';
import { channelsOnTransport, clearActiveTransport, getActiveTransport } from './activeTransport';

// username (lowercase) -> broadcaster id, for channels whose chat runs on the conduit.
// Filled when a channel goes eventsub, cleared when its chat stops or falls back to IRC.
const broadcasterByUsername = new Map<string, string>();

export function rememberBroadcaster(username: string, broadcasterId: string): void {
  broadcasterByUsername.set(username.toLowerCase(), broadcasterId);
}

export function forgetBroadcaster(username: string): void {
  broadcasterByUsername.delete(username.toLowerCase());
}

export function broadcasterIdFor(username: string): string | null {
  return broadcasterByUsername.get(username.toLowerCase()) ?? null;
}

export function usernameForBroadcaster(broadcasterId: string): string | null {
  for (const [username, id] of broadcasterByUsername) {
    if (id === broadcasterId) return username;
  }
  return null;
}

// ircBot and the conduit runtime pull in the DB, so they load on first use rather than at import.
const irc = () => require('../util/ircBot') as typeof import('../util/ircBot');
const conduitRegistry = () =>
  (require('../eventsub/conduitRuntime') as typeof import('../eventsub/conduitRuntime')).getConduitRuntime()?.registry ?? null;

const conduitOutageMonitor = () =>
  (require('../eventsub/conduitRuntime') as typeof import('../eventsub/conduitRuntime')).getConduitRuntime()?.outageMonitor ?? null;

/** True when an IRC client entry exists for the channel (connected or not). */
export function hasIrcClient(username: string): boolean {
  return Boolean(irc().clients[username]);
}

/** The channel's IRC client, or undefined when its chat is not on IRC. */
export function ircClientFor(username: string) {
  if (getActiveTransport(username) === 'eventsub') return undefined;
  return irc().clients[username];
}

/** True when the channel's chat is on the conduit. */
export function isEventSubChat(username: string): boolean {
  return getActiveTransport(username) === 'eventsub';
}

/** Is the channel's chat live on whichever transport carries it? */
export function isChatActive(username: string): boolean {
  if (getActiveTransport(username) === 'eventsub') {
    const id = broadcasterIdFor(username);
    return Boolean(id && conduitRegistry()?.isChatActive(id));
  }
  return Boolean(irc().clients[username]?.connected);
}

/** Does the channel have a chat connection or subscription at all (live or not)? */
export function hasChat(username: string): boolean {
  if (getActiveTransport(username) === 'eventsub') return isChatActive(username);
  return hasIrcClient(username);
}

/** Channels with a chat presence: every IRC client plus every channel on the conduit. */
export function activeChatUsernames(): string[] {
  return [...new Set([...Object.keys(irc().clients), ...channelsOnTransport('eventsub')])];
}

/** Stops whichever transport carries the channel's chat, then forgets the transport choice. */
export async function stopChat(username: string, intentional = false): Promise<void> {
  // The chat sub can outlive an IRC fallback (the monitor flips the gate but leaves the sub), so remove it
  // whenever a broadcaster id is known, whatever the active transport.
  const id = broadcasterIdFor(username);
  const registry = conduitRegistry();
  if (id && registry) {
    try {
      await registry.removeChat(id);
      logger.info(`[EventSubChat] Removed the conduit chat subscription for ${username}.`);
    } catch (err: any) {
      logger.warn(`[EventSubChat] Could not remove the conduit chat subscription for ${username}: ${err?.message || err}`);
    }
  }
  conduitOutageMonitor()?.forgetChannel(username);
  // No-op without an IRC client; also clears one that lingers after a transport switch.
  await irc().stopChatBot(username, intentional);
  forgetBroadcaster(username);
  clearActiveTransport(username);
}
