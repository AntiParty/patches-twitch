import logger from '../util/logger';
import type { createSubscriptionRegistry } from '../eventsub/subscriptionRegistry';
import type { ChatTransport } from './activeTransport';
import { forgetBroadcaster, rememberBroadcaster, usernameForBroadcaster } from './chatPresence';

type Registry = ReturnType<typeof createSubscriptionRegistry>;

let fallbackCount = 0;
/** Counts channels that wanted EventSub chat but ended up on IRC. */
export function recordEventSubFallback(): void {
  fallbackCount++;
}
export function eventsubFallbackCount(): number {
  return fallbackCount;
}

interface Log {
  info(msg: string): void;
  warn(msg: string): void;
}

export interface ChatStartChannel {
  username: string;
  twitch_user_id: string | null;
  chat_transport?: string | null;
}

export interface ChatStartDeps {
  stopChatBot(username: string, intentional?: boolean): Promise<void>;
  /** Starts the IRC bot (custom or default identity) and resolves to whether it authenticated. */
  startChatBot(): Promise<boolean>;
  hasIrcClient(username: string): boolean;
  /** Per-user EventSub stream subscription for this channel (closure over its token and ids). */
  addUserSubscription(): void;
  removeUserWebSocket(broadcasterId: string): void;
  setActiveTransport(username: string, transport: ChatTransport): void;
  /** Reward ids of the channel's open redeem giveaways; defaults to none. */
  getRewardIds?(): Promise<string[]>;
  /** Re-adds the channel's open redemption subscriptions on the per-user path after leaving the conduit. */
  resubscribeRedemptions?(): Promise<void>;
  registry: Pick<Registry, 'ensureChannel' | 'removeChannel' | 'hasSubscriptions'> | null;
  customBot: { bot_twitch_user_id: string } | null;
  log?: Log;
}

export function chatBotUserIdFor(customBot: { bot_twitch_user_id: string } | null): string {
  return customBot?.bot_twitch_user_id || process.env.TWITCH_BOT_USER_ID || '';
}

/**
 * Brings a channel's chat up on its configured transport and returns whether chat is live.
 *
 * eventsub: subscribe on the conduit, switch the active transport, then retire IRC and the
 * per-user EventSub socket, so a message is never dropped by both transports.
 * irc (also the fallback): start IRC, wait for it to authenticate, then hand over from the conduit.
 */
export async function chooseChatStart(channel: ChatStartChannel, deps: ChatStartDeps): Promise<boolean> {
  const log = deps.log ?? logger;
  const username = channel.username;
  const broadcasterId = String(channel.twitch_user_id || '');

  // The conduit carries stream and redemption events exactly when the runtime is on and the row prefers eventsub.
  const eventsOnConduit = channel.chat_transport === 'eventsub' && Boolean(deps.registry);

  async function startIrc(reuseExisting: boolean): Promise<boolean> {
    // Only a channel that has conduit subscriptions is "leaving the conduit"; a plain IRC channel never was on it.
    const leavingConduit = Boolean(deps.registry && broadcasterId && deps.registry.hasSubscriptions(broadcasterId));
    const authenticated = reuseExisting && deps.hasIrcClient(username) ? true : await deps.startChatBot();
    if (eventsOnConduit) {
      // Fallback: chat is on IRC, events stay on the conduit, so no per-user socket.
      if (authenticated) {
        deps.setActiveTransport(username, 'irc');
        forgetBroadcaster(username);
      }
      return authenticated;
    }
    if (authenticated) {
      deps.setActiveTransport(username, 'irc');
      forgetBroadcaster(username);
      // Moving back to IRC: take everything off the conduit before the per-user path takes over.
      if (leavingConduit) await deps.registry!.removeChannel(broadcasterId);
    }
    if (leavingConduit && !authenticated) {
      // The conduit subs are still live, so a per-user socket would double-source stream events.
      log.warn(`[EventSubChat] ${username} IRC login failed while leaving the conduit; events stay on the conduit`);
      return false;
    }
    deps.addUserSubscription();
    if (authenticated && deps.registry && deps.resubscribeRedemptions) await deps.resubscribeRedemptions();
    return authenticated;
  }

  if (channel.chat_transport !== 'eventsub') return startIrc(false);

  if (!deps.registry || !broadcasterId) {
    log.warn(`[EventSubChat] ${username} is set to eventsub but the conduit runtime is off; using IRC.`);
    recordEventSubFallback();
    return startIrc(true);
  }

  let chatOk = false;
  try {
    const rewardIds = deps.getRewardIds ? await deps.getRewardIds() : [];
    const result = await deps.registry.ensureChannel({
      broadcasterId,
      chatBotUserId: chatBotUserIdFor(deps.customBot),
      rewardIds,
    });
    chatOk = result.chatOk;
  } catch (err: any) {
    log.warn(`[EventSubChat] Subscribing ${username} failed: ${err?.message || err}`);
  }
  if (!chatOk) {
    log.warn(`[EventSubChat] Chat subscription refused for ${username}; using IRC.`);
    recordEventSubFallback();
    return startIrc(true);
  }

  // Activate the new transport first, then retire the old ones.
  rememberBroadcaster(username, broadcasterId);
  deps.setActiveTransport(username, 'eventsub');
  if (deps.hasIrcClient(username)) await deps.stopChatBot(username, true);
  deps.removeUserWebSocket(broadcasterId);
  log.info(`[EventSubChat] ${username} chat is on the conduit.`);
  return true;
}

export interface ChatTransportSwitchDeps {
  /** The channel row's start values, or null for an unknown channel. */
  findChannel(username: string): Promise<{ access_token: string | null; refresh_token: string | null; twitch_user_id: string | null } | null>;
  saveTransport(username: string, transport: ChatTransport): Promise<void>;
  /** startBotForUser: activates the new transport, then retires the old one (see chooseChatStart). */
  startBot(username: string, accessToken: string, refreshToken: string, twitchUserId: string): Promise<void>;
  getActiveTransport(username: string): ChatTransport;
}

export type ChatTransportSwitchResult =
  | { status: 'ok'; active: ChatTransport }
  | { status: 'invalid' }
  | { status: 'not_found' };

/**
 * Deliberate transport switch with no gap: persist the preference, then start the channel without
 * stopping it first, so chooseChatStart activates the new transport before retiring the old one.
 */
export async function switchChatTransport(
  username: string,
  transport: string,
  deps: ChatTransportSwitchDeps,
): Promise<ChatTransportSwitchResult> {
  if (transport !== 'irc' && transport !== 'eventsub') return { status: 'invalid' };
  const name = username.trim().toLowerCase();
  if (!name) return { status: 'invalid' };
  const row = await deps.findChannel(name);
  if (!row) return { status: 'not_found' };
  await deps.saveTransport(name, transport);
  await deps.startBot(name, row.access_token || '', row.refresh_token || '', row.twitch_user_id || '');
  return { status: 'ok', active: deps.getActiveTransport(name) };
}

export interface ChatRevocationDeps {
  registry: Pick<Registry, 'markRevoked'>;
  startChatBot(username: string): Promise<boolean>;
  setActiveTransport(username: string, transport: ChatTransport): void;
  sendWarningToDiscord(title: string, details?: string): Promise<void>;
  usernameFor?(broadcasterId: string): string | null;
  log?: Log;
}

/** Handles a conduit revocation: drop the sub from the registry; a lost chat sub moves the channel to IRC. */
export function createChatRevocationHandler(deps: ChatRevocationDeps) {
  const log = deps.log ?? logger;
  const usernameFor = deps.usernameFor ?? usernameForBroadcaster;
  return async function onRevocation(subscription: { id: string; type: string; status: string }): Promise<void> {
    const revoked = deps.registry.markRevoked(subscription.id);
    if (!revoked || revoked.type !== 'channel.chat.message') return;
    const username = usernameFor(revoked.broadcasterId);
    if (!username) {
      log.warn(`[EventSubChat] Chat subscription revoked for unknown broadcaster ${revoked.broadcasterId}.`);
      return;
    }
    log.warn(`[EventSubChat] Chat subscription revoked for ${username} (${subscription.status}); moving to IRC.`);
    recordEventSubFallback();
    try {
      await deps.startChatBot(username);
    } catch (err: any) {
      log.warn(`[EventSubChat] IRC start after revocation failed for ${username}: ${err?.message || err}`);
    }
    // The chat sub is gone, so IRC is the only possible source whether or not it authenticated yet.
    deps.setActiveTransport(username, 'irc');
    forgetBroadcaster(username);
    await deps
      .sendWarningToDiscord('EventSub chat revoked', `${username}: ${subscription.status}`)
      .catch((err) => log.warn(`[EventSubChat] Discord warning failed: ${err?.message || err}`));
  };
}
