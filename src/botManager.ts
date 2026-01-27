import { Channel } from "./db";
import { startChatBot, stopChatBot, reconnectChatBot } from "./util/ircBot";
import { addUserSubscription } from "./util/twitchEventSubWs";
import { loadCommands } from "./handlers/commands";
import { sendChatMessage } from "./util/ircBot"
import { startStreamSessionPolling } from './jobs/streamSessionPoller'; // Import polling job
import logger from "./util/logger";
import axios from "axios";
import { isUserAssignedToShard } from "./util/sharding";

const clientId = process.env.TWITCH_CLIENT_ID!;
const clientSecret = process.env.TWITCH_CLIENT_SECRET!;

const refreshTimers: { [key: string]: NodeJS.Timeout } = {};
const tokenRefreshFailures: { [key: string]: number } = {};

export class BotManager {
  private commandHandler: any;
  private lastValidated: Record<string, number> = {};

  constructor() {
    this.commandHandler = loadCommands();
    // Start polling for missing stream sessions when BotManager is instantiated
    // Note: The poller itself must handle sharding logic internally or we pass it here
    startStreamSessionPolling();
  }

  private async getChannels(): Promise<Channel[]> {
    let channels = await Channel.findAll();
    
    // Filter by Shard
    channels = channels.filter((c: any) => isUserAssignedToShard(c.username));

    if (process.env.NODE_ENV === 'development' && process.env.DEV_CHANNELS) {
      const allowed = process.env.DEV_CHANNELS.split(',').map(s => s.trim().toLowerCase());
      if (allowed.length > 0) {
        channels = channels.filter((c: any) => allowed.includes(c.username.toLowerCase()));
      }
    }
    return channels;
  }

  public async startBotForUser(username: string, accessToken: string, refreshToken: string, twitchUserId: string) {
    if (!isUserAssignedToShard(username)) {
      logger.warn(`[Sharding] Skipping startBotForUser for ${username} (not assigned to this shard)`);
      return;
    }

    try {
      // Use the cached command handler instead of reloading every time
      const channel = await Channel.findOne({ where: { username } });
      if (!channel || !channel.bot_enabled) {
        logger.info(`Bot not enabled for ${username}`);
        return;
      } else {
        await startChatBot(username, this.commandHandler);
        addUserSubscription(twitchUserId, accessToken, twitchUserId);
      }
      
      logger.info(`Bot started successfully for ${username}`);
    } catch (error) {
      logger.error(`Failed to start bot for ${username}:`, error);
    }
  }

  public async stopBotForUser(username: string) {
    try {
      await stopChatBot(username);
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

      // Reconnect bot with cached command handler
      await reconnectChatBot(username, this.commandHandler);
      logger.info(`[${username}] Bot reconnected after token refresh.`);
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

  public async validateToken(
    username: string,
    accessToken: string,
    refreshToken: string
  ) {
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
    } catch (error) {
      logger.error(`[${username}] Token validation failed. Refreshing now...`);
      this.refreshTokenFunction(username, refreshToken);
    }
  }

  public async validateAllTokens(prefetchedChannels?: Channel[]) {
    const channels = prefetchedChannels || await this.getChannels();
    const validationWindow = 30 * 60 * 1000; // 30 minutes
    const debounceTime = 10 * 60 * 1000; // Only re-validate every 10 minutes if in window

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

      const now = Date.now();

      if (!token_expires_at) {
        // Unknown expiry -> validate once to learn TTL and schedule refresh
        // Only validate if not recently validated to avoid spam on every loop if DB update fails or is slow
        if (!this.lastValidated[username] || now - this.lastValidated[username] > debounceTime) {
          logger.info(`No expiry stored for ${username}, validating token to schedule refresh.`);
          await this.validateToken(username, access_token, refresh_token);
          this.lastValidated[username] = now;
        }
        continue;
      }

      const timeLeft = new Date(token_expires_at).getTime() - now;
      if (timeLeft <= 0) {
        // Expired - try refresh immediately. 
        // Throttle this too just in case refresh fails repeatedly? 
        // refreshTokenFunction has its own retry/cooldown logic usually, so we can rely on that mostly,
        // but let's debounce slightly to match loop frequency if needed.
        logger.info(`Token for ${username} has expired (or is extremely close). Refreshing...`);
        await this.refreshTokenFunction(username, refresh_token);
        // We don't mark validated here because we want refresh to happen.
      } else if (timeLeft <= validationWindow) {
        // Check if we validated recently to avoid spamming logs every minute
        if (this.lastValidated[username] && now - this.lastValidated[username] < debounceTime) {
          continue;
        }

        // If token will expire within the validation window, call validate to update schedule
        logger.info(`Token for ${username} expires soon (in ${Math.round(timeLeft / 1000)}s). Validating.`);
        await this.validateToken(username, access_token, refresh_token);
        this.lastValidated[username] = now;
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
    await this.validateAllTokens(channels);
    this.startTokenValidationInterval();
    await this.loadChannels(channels);
  }

  public async loadChannels(prefetchedChannels?: Channel[]) {
    try {
      const channels = prefetchedChannels || await this.getChannels();
      logger.info(`Found ${channels.length} channels to load`);

      for (const channel of channels) {
        const chanAny: any = channel as any;
        const username = chanAny.username;
        const access_token = chanAny.access_token;
        const refresh_token = chanAny.refresh_token;
        const twitch_user_id = chanAny.twitch_user_id;
        if (username && access_token && twitch_user_id) {
          logger.info(`Loading channel: ${username}`);
          await this.validateToken(username, access_token, refresh_token);
          await this.startBotForUser(username, access_token, refresh_token, twitch_user_id);
        }
      }
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
      if (!isUserAssignedToShard(channelName)) {
        logger.debug(`[Sharding] Skipping sendMessage for ${channelName} (not assigned to this shard)`);
        return;
      }

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
      const channels = await this.getChannels(); // Respects sharding

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