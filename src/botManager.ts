import { Channel } from "./db";
import { startChatBot, stopChatBot, reconnectChatBot } from "./util/ircBot";
import { addUserSubscription } from "./util/twitchEventSubWs";
import { loadCommands } from "./handlers/commands";
import { sendChatMessage  } from "./util/ircBot"
import logger from "./util/logger";
import { refreshAccessToken } from "./util/twitchUtils";

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

  // REMOVED: refreshTokenFunction. Use refreshAccessToken from twitchUtils.ts everywhere.

  // REMOVED: scheduleTokenRefresh. Use centralized refresh logic and rely on token expiry checks.

  public async validateToken(
    username: string,
    accessToken: string,
    refreshToken: string
  ) {
    try {
      const response = await axios.get("https://id.twitch.tv/oauth2/validate", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      // If token is valid, do nothing. If you want to schedule a refresh, do it via token expiry checks elsewhere.
    } catch (error) {
      logger.error(`[${username}] Token validation failed. Refreshing now...`);
      // Use centralized refresh logic
      const channel = await Channel.findOne({ where: { username } });
      if (channel) {
        await refreshAccessToken(channel);
      }
    }
  }

  public async validateAllTokens() {
    const channels = await Channel.findAll();
    for (const channel of channels) {
      const { username, access_token, refresh_token, token_expires_at } = channel;
      if (access_token && refresh_token && token_expires_at) {
        const timeLeft = new Date(token_expires_at).getTime() - new Date().getTime();
        if (timeLeft > 0) {
          await this.validateToken(username, access_token, refresh_token);
        } else {
          logger.info(`Token for ${username} has expired. Refreshing...`);
          await refreshAccessToken(channel);
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