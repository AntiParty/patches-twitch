import { Channel } from "./db";
import { startChatBot, stopChatBot, reconnectChatBot } from "./util/ircBot";
import { addUserSubscription } from "./util/twitchEventSubWs";
import { loadCommands } from "./handlers/commands";
import { sendChatMessage  } from "./util/ircBot"
import logger from "./util/logger";
import axios from "axios";

const clientId = process.env.TWITCH_CLIENT_ID!;
const clientSecret = process.env.TWITCH_CLIENT_SECRET!;

const refreshTimers: { [key: string]: NodeJS.Timeout } = {};
const tokenRefreshFailures: { [key: string]: number } = {};

export class BotManager {
  private commandHandler: any;

  constructor() {
    this.commandHandler = loadCommands();
  }

  public async startBotForUser(username: string, accessToken: string, refreshToken: string, twitchUserId: string) {
    try {
      // Always reload commands before starting each bot
      const freshCommandHandler = loadCommands();
      await startChatBot(username, freshCommandHandler);
      
      // Subscribe user to EventSub via WebSocket
      addUserSubscription(twitchUserId, accessToken, twitchUserId);
      
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
      const channel = await Channel.findOne({ where: { username } });
      if (!channel) {
        logger.error(`No channel found for ${username}`);
        return;
      }
      channel.refresh_token = refreshToken;
      const newAccessToken = await require("./util/twitchUtils").refreshAccessToken(channel);
      if (!newAccessToken) {
        logger.error(`[${username}] Token refresh failed (via twitchUtils)`);
        // Retry handled by twitchUtils, so no need to retry here
        return;
      }
      // Update token refresh timer
      const expiresIn = channel.token_expires_at
        ? new Date(channel.token_expires_at).getTime() - new Date().getTime()
        : 3600 * 1000;
      this.scheduleTokenRefresh(
        username,
        channel.refresh_token,
        expiresIn - 5 * 60 * 1000
      );
      // Reconnect bot with fresh token
      const freshCommandHandler = loadCommands();
      await reconnectChatBot(username, freshCommandHandler);
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

  public async validateAllTokens() {
    const channels = await Channel.findAll();

    for (const channel of channels) {
      const { username, access_token, refresh_token, token_expires_at } = channel;
      if (access_token && refresh_token && token_expires_at) {
        const timeLeft =
          new Date(token_expires_at).getTime() - new Date().getTime();
        if (timeLeft > 0) {
          await this.validateToken(username, access_token, refresh_token);
        } else {
          logger.info(`Token for ${username} has expired. Refreshing...`);
          await this.refreshTokenFunction(username, refresh_token);
        }
      } else {
        logger.warn(`No tokens found for ${username}, skipping...`);
      }
    }
  }

  public startTokenValidationInterval() {
    const intervalTime = 15 * 1000;
    setInterval(() => this.validateAllTokens(), intervalTime);
    logger.info(
      `Started periodic token validation every ${intervalTime / 1000} seconds.`
    );
  }

  public async loadTokensOnStartup() {
    logger.info("Loading stored tokens...");
    await this.validateAllTokens();
    this.startTokenValidationInterval();
  }

  public async loadChannels() {
    try {
      const channels = await Channel.findAll();
      logger.info(`Found ${channels.length} channels to load`);
      
      for (const channel of channels) {
        const { username, access_token, refresh_token, twitch_user_id } = channel;
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
      const user = await Channel.findOne({
        where: { username: channelName },
      });
      if (!user?.twitch_user_id) {
        throw new Error(`Channel ${channelName} not found or missing twitch_user_id`);
      }

      logger.info(`[Admin] Sending message to ${channelName}: ${message}`);
      await sendChatMessage(user.twitch_user_id, message);
    } else {
      const channels = await Channel.findAll({
        attributes: ["username", "twitch_user_id"],
      });

      for (const { username, twitch_user_id } of channels) {
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
}

// Export singleton instance
export const botManager = new BotManager();