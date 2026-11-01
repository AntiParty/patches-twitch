import { Channel, CustomBotAccount, Giveaway } from "./db";
import { Op } from "sequelize";
import { startChatBot, stopChatBot } from "./util/ircBot";
import { addUserSubscription, removeUserWebSocket } from "./util/twitchEventSubWs";
import { loadCommands } from "./handlers/commands";
import { sendChatMessage } from "./util/ircBot"
import { startStreamSessionPolling } from './jobs/streamSessionPoller'; // Import polling job
import {
  decryptCustomBotAccessToken,
  decryptCustomBotRefreshToken,
  refreshCustomBotAccessToken,
} from "./util/twitchUtils";
import logger from "./util/logger";
import axios from "axios";
import { restartBotIdentity } from "./services/botIdentityRestart.service";
import { mapWithConcurrency } from "./util/concurrency";
import { chooseChatStart, chatBotUserIdFor } from "./chat/chatTransportSwitch";
import { clearActiveTransport, setActiveTransport } from "./chat/activeTransport";
import { forgetBroadcaster, hasChat, hasIrcClient, isChatActive, rememberBroadcaster, stopChat } from "./chat/chatPresence";
import { getConduitRuntime } from "./eventsub/conduitRuntime";

export { chooseChatStart };
const clientId = process.env.TWITCH_CLIENT_ID!;
const clientSecret = process.env.TWITCH_CLIENT_SECRET!;

const LOAD_CHANNEL_CONCURRENCY = 5;

const refreshTimers: { [key: string]: NodeJS.Timeout } = {};
const tokenRefreshFailures: { [key: string]: number } = {};
// Per-username guard so two paths (token-refresher rescue scan + reconnect
// loop, control-API + auto-reconnect, etc.) can't both be inside
// startBotForUser for the same channel at once. Without this, the second
// caller can reach `startChatBot` while the first is still mid-handshake,
// producing a duplicate connection attempt that Twitch rejects with
// "Login authentication failed".
const startingBots = new Set<string>();

export class BotManager {
  private commandHandler: any;

  constructor() {
    this.commandHandler = loadCommands();
    // Start polling for missing stream sessions when BotManager is instantiated
    startStreamSessionPolling();
  }

  public getCommandHandler(): Record<string, any> {
    return this.commandHandler;
  }

  private async getChannels(): Promise<Channel[]> {
    let channels = await Channel.findAll();
    if (process.env.NODE_ENV === 'development' && process.env.DEV_CHANNELS) {
      const allowed = process.env.DEV_CHANNELS.split(',').map(s => s.trim().toLowerCase());
      if (allowed.length > 0) {
        channels = channels.filter((c: any) => allowed.includes(c.username.toLowerCase()));
      }
    }
    return channels;
  }

  public async startBotForUser(
    username: string,
    accessToken: string,
    refreshToken: string,
    twitchUserId: string,
    // Bulk startup already holds fresh rows; passing them skips two queries per channel.
    prefetched?: { channel: Channel; customBot: CustomBotAccount | null },
  ) {
    if (startingBots.has(username)) {
      logger.info(`[${username}] startBotForUser already in progress; skipping concurrent call.`);
      return;
    }
    startingBots.add(username);
    try {
      // Use the cached command handler instead of reloading every time
      const channel = prefetched?.channel ?? await Channel.findOne({ where: { username } });
      if (!channel || !channel.bot_enabled) {
        logger.info(`Bot not enabled for ${username}`);
        return;
      } else {
        const currentAccessToken = (channel as any).access_token || accessToken;
        const currentTwitchUserId = (channel as any).twitch_user_id || twitchUserId;

        // Check for custom bot account
        const customBot = prefetched
          ? prefetched.customBot
          : await CustomBotAccount.findOne({ where: { channel_id: channel.id, is_active: true } });

        const activeCustomBot = this.customBotWithAccess(channel, customBot);

        const authenticated = await chooseChatStart(channel, {
          stopChatBot,
          startChatBot: () => this.startIrcChat(username, activeCustomBot),
          hasIrcClient,
          addUserSubscription: () => addUserSubscription(currentTwitchUserId, currentAccessToken, currentTwitchUserId),
          removeUserWebSocket,
          setActiveTransport,
          getRewardIds: () => this.openRewardIds(username),
          registry: getConduitRuntime()?.registry ?? null,
          customBot: activeCustomBot,
        });

        if (!authenticated) {
          logger.warn(`Bot start did not authenticate for ${username}`);
          return;
        }
      }
      
      logger.info(`Bot started successfully for ${username}`);
    } catch (error) {
      logger.error(`Failed to start bot for ${username}:`, error);
    } finally {
      startingBots.delete(username);
    }
  }

  /** The channel's custom bot, or null when it has none or the channel may not use one. */
  private customBotWithAccess(channel: Channel, customBot: CustomBotAccount | null): CustomBotAccount | null {
    const isPrivileged = ['tester', 'Staff', 'admin'].includes(channel.role);
    return customBot && (channel.has_subscription || isPrivileged) ? customBot : null;
  }

  /** Starts IRC chat with the custom bot identity when given, else the default bot. */
  private async startIrcChat(username: string, customBot: CustomBotAccount | null): Promise<boolean> {
    if (!customBot) return startChatBot(username, this.commandHandler);

    logger.info(`Starting custom bot ${customBot.bot_username} for channel ${username}`);

    // Tokens in CustomBotAccount may be encrypted (post-rotation) or
    // plaintext (legacy rows from before encryption was wired up).
    // Decrypt before handing to IRC, and proactively refresh if expired.
    let accessPlain = decryptCustomBotAccessToken(customBot);
    let refreshPlain = decryptCustomBotRefreshToken(customBot);
    const expiresAt = (customBot as any).bot_token_expires_at
      ? new Date((customBot as any).bot_token_expires_at).getTime()
      : 0;
    const expired = expiresAt && expiresAt - Date.now() <= 60 * 1000;

    if (expired || !accessPlain) {
      const refreshed = await refreshCustomBotAccessToken(customBot);
      if (refreshed) {
        accessPlain = refreshed.accessToken;
        refreshPlain = refreshed.refreshToken;
      }
    }

    if (!accessPlain) {
      logger.warn(`[${username}] Custom bot token unavailable after refresh attempt — falling back to default bot.`);
      return startChatBot(username, this.commandHandler);
    }
    return startChatBot(username, this.commandHandler, {
      botUsername: customBot.bot_username,
      botToken: accessPlain,
      botUserId: customBot.bot_twitch_user_id,
      refreshToken: refreshPlain || ''
    });
  }

  /** Moves a channel whose conduit chat subscription was lost onto IRC. */
  public async startIrcFallback(username: string): Promise<boolean> {
    const channel = await Channel.findOne({ where: { username } });
    if (!channel) return false;
    const customBot = await CustomBotAccount.findOne({ where: { channel_id: channel.id, is_active: true } });
    return this.startIrcChat(username, this.customBotWithAccess(channel, customBot));
  }

  /** Reward ids of the channel's open channel-point giveaways. */
  private async openRewardIds(username: string): Promise<string[]> {
    const rows = await Giveaway.findAll({ where: { channel: username, type: "redeem", status: { [Op.ne]: "closed" } } });
    return rows.map((row) => row.reward_id).filter((id): id is string => Boolean(id));
  }

  public async stopBotForUser(username: string, intentional: boolean = true) {
    try {
      await stopChat(username, intentional);
      logger.info(`Bot stopped for ${username}`);
    } catch (error) {
      logger.error(`Failed to stop bot for ${username}:`, error);
    }
  }

  public async refreshTokenFunction(username: string, refreshToken: string) {
    if (!refreshToken) {
      logger.error(`No refresh token for ${username}`);
      return;
    }
    try {
      logger.info(`[${username}] Refreshing access token (via twitchUtils)...`);
      // Always fetch fresh channel data from DB to avoid race conditions
      const channel = await Channel.findOne({ where: { username } });
      if (!channel) {
        logger.error(`No channel found for ${username}`);
        return;
      }
      // Use the refresh token from DB, not the parameter (which may be stale)
      const dbRefreshToken = (channel as any).refresh_token || refreshToken;
      if (!dbRefreshToken) {
        logger.error(`No refresh token in database for ${username}`);
        return;
      }
      // Ensure channel has the latest refresh token
      (channel as any).refresh_token = dbRefreshToken;

      const newAccessToken = await require("./util/twitchUtils").refreshAccessToken(channel);
      if (!newAccessToken) {
        logger.error(`[${username}] Token refresh failed (via twitchUtils)`);
        // Retry handled by twitchUtils, so no need to retry here
        return;
      }

      // Re-fetch channel to get updated token_expires_at after refresh
      const updatedChannel = await Channel.findOne({ where: { username } });
      if (!updatedChannel) {
        logger.warn(`[${username}] Channel not found after refresh, cannot update timer`);
        return;
      }

      // Update token refresh timer with fresh data
      const expiresIn = (updatedChannel as any).token_expires_at
        ? new Date((updatedChannel as any).token_expires_at).getTime() - Date.now()
        : 3600 * 1000;

      if (expiresIn > 0) {
        this.scheduleTokenRefresh(
          username,
          (updatedChannel as any).refresh_token,
          expiresIn - 5 * 60 * 1000
        );
      }

      // Channel OAuth tokens are for EventSub/Helix user operations, not IRC
      // PASS. Reconnecting chat here races startup sockets and can make Twitch
      // reject duplicate default-bot handshakes.
      tokenRefreshFailures[username] = 0;
    } catch (error) {
      tokenRefreshFailures[username] = (tokenRefreshFailures[username] || 0) + 1;
      logger.error(`[${username}] Token refresh failed (exception):`, error);
      // Retry handled by twitchUtils, so no need to retry here
    }
  }

  private scheduleTokenRefresh(
    username: string,
    refreshToken: string,
    refreshTime: number
  ) {
    if (refreshTimers[username]) clearTimeout(refreshTimers[username]);

    if (refreshTime > 0) {
      refreshTimers[username] = setTimeout(
        () => this.refreshTokenFunction(username, refreshToken),
        refreshTime
      );
    } else {
      setTimeout(() => this.refreshTokenFunction(username, refreshToken), 60 * 1000);
    }
  }

  /** Returns true when validation failed and a refresh was attempted (the DB row may have changed). */
  public async validateToken(
    username: string,
    accessToken: string,
    refreshToken: string
  ): Promise<boolean> {
    try {
      const response = await axios.get("https://id.twitch.tv/oauth2/validate", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const expiresIn = response.data.expires_in;
      this.scheduleTokenRefresh(
        username,
        refreshToken,
        expiresIn * 1000 - 5 * 60 * 1000
      );
      return false;
    } catch (error) {
      logger.error(`[${username}] Token validation failed. Refreshing now...`);
      await this.refreshTokenFunction(username, refreshToken);
      return true;
    }
  }

  public async validateAllTokens(prefetchedChannels?: Channel[]) {
    const channels = prefetchedChannels || await this.getChannels();
    const validationWindow = 30 * 60 * 1000; // 30 minutes

    for (const channel of channels) {
      const chanAny: any = channel as any;
      const username = chanAny.username;
      const access_token = chanAny.access_token;
      const refresh_token = chanAny.refresh_token;
      const token_expires_at = chanAny.token_expires_at;

      if (!access_token || !refresh_token) {
        logger.warn(`No tokens found for ${username}, skipping...`);
        continue;
      }

      // Skip channels whose token was permanently revoked — don't hammer Twitch.
      // User must re-authenticate at finalsrs.com to clear this flag.
      if ((chanAny as any).auth_revoked) {
        logger.debug?.(`[${username}] auth_revoked=true, skipping token validation.`);
        continue;
      }

      if (!token_expires_at) {
        // Unknown expiry -> validate once to learn TTL and schedule refresh
        logger.info(`No expiry stored for ${username}, validating token to schedule refresh.`);
        await this.validateToken(username, access_token, refresh_token);
        continue;
      }

      const timeLeft = new Date(token_expires_at).getTime() - Date.now();
      if (timeLeft <= 0) {
        logger.info(`Token for ${username} has expired. Refreshing...`);
        await this.refreshTokenFunction(username, refresh_token);
      } else if (timeLeft <= validationWindow) {
        // If token will expire within the validation window, call validate to update schedule
        logger.info(`Token for ${username} expires soon (in ${Math.round(timeLeft / 1000)}s). Validating.`);
        await this.validateToken(username, access_token, refresh_token);
      } else {
        // Token healthy and not near expiry; skip to avoid unnecessary API calls
        logger.debug?.(`Token for ${username} healthy, skipping validation.`);
      }
    }
  }

  public startTokenValidationInterval() {
    const intervalTime = 60 * 1000; // run every 60s; actual validations are skipped for healthy tokens
    setInterval(() => this.validateAllTokens(), intervalTime);
    logger.info(`Started periodic token validation every ${intervalTime / 1000} seconds.`);
  }

  public async loadTokensOnStartup() {
    logger.info("Loading stored tokens and starting bots...");
    const channels = await this.getChannels();
    this.startTokenValidationInterval();
    await this.loadChannels(channels);
  }

  public async restartBotFromCurrentState(username: string) {
    return restartBotIdentity(username, {
      getChannel: async (channelUsername) => {
        const channel: any = await Channel.findOne({ where: { username: channelUsername } });
        if (!channel) return null;
        return {
          username: channel.username,
          access_token: channel.access_token,
          refresh_token: channel.refresh_token,
          twitch_user_id: channel.twitch_user_id,
        };
      },
      stopBot: async (channelUsername) => this.stopBotForUser(channelUsername, false),
      startBot: async (channel) => this.startBotForUser(
        channel.username,
        channel.access_token || "",
        channel.refresh_token || "",
        channel.twitch_user_id || "",
      ),
      hasClient: (channelUsername) => hasChat(channelUsername),
      isAuthenticated: (channelUsername) => isChatActive(channelUsername),
      sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    });
  }

  /** Reconciles all conduit channels in one pass; channels whose chat sub did not come up fall back to IRC. */
  private async reconcileConduitChannels(
    registry: NonNullable<ReturnType<typeof getConduitRuntime>>['registry'],
    channels: Channel[],
    customBotByChannelId: Map<number, CustomBotAccount>,
  ) {
    const openGiveaways = await Giveaway.findAll({ where: { type: "redeem", status: { [Op.ne]: "closed" } } });
    const rewardsByChannel = new Map<string, string[]>();
    for (const giveaway of openGiveaways) {
      if (!giveaway.reward_id) continue;
      const list = rewardsByChannel.get(giveaway.channel) ?? [];
      list.push(giveaway.reward_id);
      rewardsByChannel.set(giveaway.channel, list);
    }

    // Chat messages can arrive as soon as the shards are up, so the transport flips first.
    for (const channel of channels) {
      rememberBroadcaster(channel.username, channel.twitch_user_id!);
      setActiveTransport(channel.username, 'eventsub');
    }
    try {
      const result = await registry.reconcileAll(
        channels.map((channel) => ({
          broadcasterId: channel.twitch_user_id!,
          chatBotUserId: chatBotUserIdFor(this.customBotWithAccess(channel, customBotByChannelId.get(channel.id) ?? null)),
          rewardIds: rewardsByChannel.get(channel.username) ?? [],
        })),
      );
      logger.info(`[Conduit] Reconciled ${channels.length} channels: ${result.created} created, ${result.removed} removed, ${result.failed.length} failed`);
    } catch (error) {
      logger.error('[Conduit] Reconcile failed:', error);
    }

    const dark = channels.filter((channel) => !registry.isChatActive(channel.twitch_user_id!));
    await mapWithConcurrency(dark, LOAD_CHANNEL_CONCURRENCY, async (channel) => {
      // startBotForUser retries the chat subscription, then falls back to IRC.
      forgetBroadcaster(channel.username);
      clearActiveTransport(channel.username);
      await this.startBotForUser(
        channel.username,
        channel.access_token || "",
        channel.refresh_token || "",
        channel.twitch_user_id || "",
        { channel, customBot: customBotByChannelId.get(channel.id) ?? null },
      );
    });
  }

  public async loadChannels(prefetchedChannels?: Channel[]) {
    try {
      const allChannels = prefetchedChannels || await this.getChannels();
      // Disabled channels would bail inside startBotForUser anyway; skip their
      // validate call too. The periodic validateAllTokens pass still covers them.
      const channels = allChannels.filter((channel) => channel.bot_enabled);
      logger.info(`Found ${channels.length} enabled channels to load (${allChannels.length} total)`);

      const customBots = await CustomBotAccount.findAll({ where: { is_active: true } });
      const customBotByChannelId = new Map<number, CustomBotAccount>();
      // First match wins, mirroring the findOne this replaces.
      for (const bot of customBots) {
        if (!customBotByChannelId.has(bot.channel_id)) customBotByChannelId.set(bot.channel_id, bot);
      }

      // Channels on the conduit skip startBotForUser: one reconcile below covers all of them.
      // With the runtime off they stay on the normal path, which falls back to IRC with a warning.
      const registry = getConduitRuntime()?.registry ?? null;
      const conduitChannels = registry
        ? channels.filter((channel) => channel.chat_transport === 'eventsub' && channel.twitch_user_id)
        : [];
      const conduitChannelIds = new Set(conduitChannels.map((channel) => channel.id));

      const startedAt = Date.now();
      // IRC logins are rate limited per bot account inside startChatBot, so
      // this only bounds how many validate/handshake round trips overlap.
      await mapWithConcurrency(channels, LOAD_CHANNEL_CONCURRENCY, async (channel) => {
        const chanAny: any = channel as any;
        const username = chanAny.username;
        if (!username || !chanAny.access_token || !chanAny.twitch_user_id) return;
        try {
          logger.info(`Loading channel: ${username}`);
          // Broadcaster tokens are still used for predictions and rewards on every transport.
          const refreshed = await this.validateToken(username, chanAny.access_token, chanAny.refresh_token);
          // A refresh rewrote the token columns; pick them up before starting.
          if (refreshed) await channel.reload();
          if (conduitChannelIds.has(channel.id)) return;
          await this.startBotForUser(
            username,
            chanAny.access_token,
            chanAny.refresh_token,
            chanAny.twitch_user_id,
            { channel, customBot: customBotByChannelId.get(channel.id) ?? null },
          );
        } catch (error) {
          logger.error(`[${username}] Failed to load channel:`, error);
        }
      });
      if (registry && conduitChannels.length) {
        await this.reconcileConduitChannels(registry, conduitChannels, customBotByChannelId);
      }
      logger.info(`Loaded ${channels.length} channels in ${Date.now() - startedAt}ms`);
    } catch (error) {
      logger.error('Error loading channels:', error);
      throw error;
    }
  }

  public async sendMessage(message: string, channelName?: string) {
    if (!message.trim()) {
      throw new Error("Message cannot be empty");
    }

    if (channelName) {
      const user = await Channel.findOne({
        where: { username: channelName },
      });
      const userAny: any = user as any;
      if (!userAny?.twitch_user_id) {
        throw new Error(`Channel ${channelName} not found or missing twitch_user_id`);
      }

      logger.info(`[Admin] Sending message to ${channelName}: ${message}`);
      await sendChatMessage(userAny.twitch_user_id, message);
    } else {
      const channels = await Channel.findAll({
        attributes: ["username", "twitch_user_id"],
      });

      for (const ch of channels) {
        const username = (ch as any).username;
        const twitch_user_id = (ch as any).twitch_user_id;
        if (!twitch_user_id) continue;
        try {
          logger.info(`[Admin] Sending message to ${username}: ${message}`);
          await sendChatMessage(twitch_user_id, message);
        } catch (err) {
          logger.error(`[Admin] Failed to send to ${username}:`, err);
        }
      }
    }
  }

  public async pauseAll() {
    logger.info("[BotManager] Pausing all bots...");
    const channels = await this.getChannels();
    for (const channel of channels) {
      const username = (channel as any).username;
      await this.stopBotForUser(username);
    }
    logger.info("[BotManager] All bots paused.");
  }

  public async resumeAll() {
    logger.info("[BotManager] Resuming all bots...");
    await this.loadChannels();
    logger.info("[BotManager] All bots resumed.");
  }

  /**
   * Manually reload commands from disk
   */
  public reloadCommands() {
    this.commandHandler = loadCommands();
    logger.info("[BotManager] Command handlers reloaded.");
  }
}

// Export singleton instance
export const botManager = new BotManager();
