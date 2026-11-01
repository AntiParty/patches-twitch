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
  registry: Pick<Registry, 'ensureChannel' | 'removeChat' | 'isChatActive'> | null;
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

  async function startIrc(reuseExisting: boolean): Promise<boolean> {
    const authenticated = reuseExisting && deps.hasIrcClient(username) ? true : await deps.startChatBot();
    // Stream/redemption events keep their per-user socket path while IRC carries chat.
    deps.addUserSubscription();
    if (authenticated) {
      deps.setActiveTransport(username, 'irc');
      forgetBroadcaster(username);
      if (deps.registry && broadcasterId && deps.registry.isChatActive(broadcasterId)) {
        await deps.registry.removeChat(broadcasterId);
      }
    }
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
