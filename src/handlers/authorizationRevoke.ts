import logger from '../util/logger';

/** `user.authorization.revoke` event: someone disconnected our app in their Twitch settings. */
export interface AuthorizationRevokeEvent {
  client_id: string;
  user_id: string;
  user_login: string | null;
  user_name: string | null;
}

export interface AuthorizationRevokeDeps {
  findChannelByTwitchId(twitchUserId: string): Promise<{ username: string } | null>;
  isCustomBot(twitchUserId: string): Promise<boolean>;
  markChannelRevoked(twitchUserId: string): Promise<void>;
  stopBot(username: string): Promise<void>;
  removeSubscriptions(twitchUserId: string): Promise<void>;
  warn(title: string, details: string): Promise<void>;
  defaultBotUserId?: string;
}

/**
 * Stops the bot and drops subscriptions for a broadcaster who revoked access, so we stop acting for them
 * right away instead of finding out at the next token refresh. Bot accounts only raise a warning:
 * their channels need the owner to re-link a bot.
 */
export function createAuthorizationRevokeHandler(deps: AuthorizationRevokeDeps) {
  return async (event: AuthorizationRevokeEvent): Promise<void> => {
    const userId = String(event?.user_id || '');
    if (!userId) return;
    const who = event.user_login || userId;

    if (userId === deps.defaultBotUserId) {
      logger.error(`[Revoke] The default bot account ${who} revoked access`);
      await deps.warn('Default bot authorization revoked', `${who} (${userId}) disconnected the app. Chat sends will fail until it is re-linked.`);
      return;
    }

    if (await deps.isCustomBot(userId)) {
      logger.warn(`[Revoke] Custom bot account ${who} revoked access`);
      await deps.warn('Custom bot authorization revoked', `${who} (${userId}) disconnected the app; its channel needs the bot re-linked.`);
    }

    const channel = await deps.findChannelByTwitchId(userId);
    if (!channel) return;

    logger.warn(`[Revoke] ${channel.username} revoked access; stopping bot and removing subscriptions`);
    await deps.markChannelRevoked(userId);
    await deps.stopBot(channel.username);
    await deps.removeSubscriptions(userId);
  };
}
