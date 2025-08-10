import express, { Request, Response } from "express";
import axios from "axios";
import { Channel } from "./db";
import { sendMessageToDiscord } from "./handlers/discordHandler";
import { startChatBot, reconnectChatBot } from "./util/bot";
import { verifyTwitchSignature } from "./util/eventSubManager"; // keep only verify function
import { loadCommands } from "./handlers/commands";
import logger from "./util/logger";
import path from "path";
import rateLimit from "express-rate-limit";
import fs from "fs";
import * as dotenv from "dotenv";
import WebSocket from "ws";

// Load environment file based on NODE_ENV
const envFile =
  process.env.NODE_ENV === "production"
    ? ".env.production"
    : ".env.development";
dotenv.config({ path: path.resolve(__dirname, "..", envFile) });

const clientId = process.env.TWITCH_CLIENT_ID!;
const clientSecret = process.env.TWITCH_CLIENT_SECRET!;
const redirectUri = process.env.TWITCH_REDIRECT_URI!;
const cacheFilePath = path.join(
  __dirname,
  "src",
  "cache",
  "connectedAccounts.json"
);

let accessToken: string | null = null;
let refreshToken: string | null = null;
let expirationTime: number | null = null;
let twitchUsername: string | null = null;

const refreshTimers: { [key: string]: NodeJS.Timeout } = {};

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Too many requests, please try again later.",
});

const getAuthUrl = () => {
  const scope = encodeURIComponent(
    "channel:moderate user:read:chat user:bot channel:bot"
  );
  return `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&force_verify=true`;
};

const refreshTokenFunction = async (username: string, refreshToken: string) => {
  if (!refreshToken) {
    logger.error(`No refresh token for ${username}`);
    return;
  }

  try {
    logger.info(`[${username}] Refreshing access token...`);
    const response = await axios.post(
      "https://id.twitch.tv/oauth2/token",
      null,
      {
        params: {
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        },
      }
    );

    const {
      access_token,
      refresh_token: newRefreshToken,
      expires_in,
    } = response.data;

    const newExpirationTime = new Date(
      new Date().getTime() + expires_in * 1000
    );
    await Channel.update(
      {
        access_token,
        refresh_token: newRefreshToken,
        token_expires_at: newExpirationTime,
      },
      { where: { username } }
    );

    logger.info(
      `[${username}] Token refreshed. Expires in ${expires_in / 60} minutes.`
    );

    // Update global tokens if current user
    if (username === twitchUsername) {
      accessToken = access_token;
      refreshToken = newRefreshToken;
    }

    scheduleTokenRefresh(
      username,
      newRefreshToken,
      expires_in * 1000 - 5 * 60 * 1000
    );

    await reconnectChatBot(username, commandHandler);
    logger.info(`[${username}] Bot reconnected after token refresh.`);

    // Reconnect EventSub WebSocket with new token if current user
    if (username === twitchUsername && twitchEventSubClient) {
      twitchEventSubClient.updateAuthToken(access_token);
    }
  } catch (error) {
    logger.error(`[${username}] Token refresh failed:`, error);
    logger.info("Retrying in 1 minute...");
    setTimeout(() => refreshTokenFunction(username, refreshToken), 60 * 1000);
  }
};

const scheduleTokenRefresh = (
  username: string,
  refreshToken: string,
  refreshTime: number
) => {
  if (refreshTimers[username]) clearTimeout(refreshTimers[username]);

  if (refreshTime > 0) {
    refreshTimers[username] = setTimeout(
      () => refreshTokenFunction(username, refreshToken),
      refreshTime
    );
    logger.info(
      `[${username}] Next token refresh scheduled in ${(
        refreshTime /
        1000 /
        60
      ).toFixed(2)} minutes.`
    );
  } else {
    logger.warn(`[${username}] Refresh time invalid, retrying in 1 minute.`);
    setTimeout(() => refreshTokenFunction(username, refreshToken), 60 * 1000);
  }
};

export const validateToken = async (
  username: string,
  accessToken: string,
  refreshToken: string
) => {
  try {
    const response = await axios.get("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const expiresIn = response.data.expires_in;
    logger.info(
      `[${username}] Token is valid. Expires in ${expiresIn / 60} minutes.`
    );
    scheduleTokenRefresh(
      username,
      refreshToken,
      expiresIn * 1000 - 5 * 60 * 1000
    );
  } catch (error) {
    logger.error(`[${username}] Token validation failed. Refreshing now...`);
    refreshTokenFunction(username, refreshToken);
  }
};

const validateAllTokens = async () => {
  logger.info("Validating tokens for all users...");
  const channels = await Channel.findAll();

  for (const channel of channels) {
    const { username, access_token, refresh_token, token_expires_at } = channel;
    if (access_token && refresh_token && token_expires_at) {
      const timeLeft =
        new Date(token_expires_at).getTime() - new Date().getTime();
      if (timeLeft > 0) {
        await validateToken(username, access_token, refresh_token);
      } else {
        logger.info(`Token for ${username} has expired. Refreshing...`);
        await refreshTokenFunction(username, refresh_token);
      }
    } else {
      logger.warn(`No tokens found for ${username}, skipping...`);
    }
  }
};

const startTokenValidationInterval = () => {
  const intervalTime = 15 * 1000;
  setInterval(validateAllTokens, intervalTime);
  logger.info(
    `Started periodic token validation every ${intervalTime / 1000} seconds.`
  );
};

export const loadTokensOnStartup = async () => {
  logger.info("Loading stored tokens...");
  await validateAllTokens();
  startTokenValidationInterval();
};

// -------- Twitch EventSub WebSocket Client --------

const TWITCH_EVENTSUB_WS_URL = "wss://eventsub.wss.twitch.tv/ws";

interface TwitchEvent {
  subscription: {
    id: string;
    type: string;
    status: string;
    version: string;
    condition: any;
    transport: any;
    created_at: string;
  };
  event: any;
}

class TwitchEventSubWSClient {
  private ws: WebSocket | null = null;
  private reconnectTimeout?: NodeJS.Timeout;
  private sessionId: string | null = null;
  private lastMessageTimestamp: number = 0;
  private authToken: string;

  constructor(authToken: string) {
    this.authToken = authToken;
  }

  connect() {
    logger.info("Connecting to Twitch EventSub WebSocket...");
    this.ws = new WebSocket(TWITCH_EVENTSUB_WS_URL);

    this.ws.on("open", () => {
      logger.info("Twitch EventSub WebSocket connected.");
    });

    this.ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.lastMessageTimestamp = Date.now();
        await this.handleMessage(message);
      } catch (err) {
        logger.error("Failed to parse WebSocket message:", err);
      }
    });

    this.ws.on("error", (error) => {
      logger.error("WebSocket error:", error);
    });

    this.ws.on("close", (code, reason) => {
      logger.warn(
        `WebSocket closed. Code: ${code}, Reason: ${reason.toString()}`
      );
      this.cleanupAndReconnect();
    });
  }

  cleanupAndReconnect() {
    if (this.ws) {
      this.hasSubscribed = false;
      this.ws.removeAllListeners();
      this.ws = null;
    }

    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);

    this.reconnectTimeout = setTimeout(() => {
      logger.info("Reconnecting to Twitch EventSub WebSocket...");
      this.connect();
    }, 10000);
  }

  sendMessage(msg: object) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      logger.warn("WebSocket not open, cannot send message.");
    }
  }

  // Fetch Twitch User ID dynamically from API by username
  async fetchTwitchUserId(username: string): Promise<string | null> {
    try {
      const response = await axios.get(
        `https://api.twitch.tv/helix/users?login=${username}`,
        {
          headers: {
            Authorization: `Bearer ${this.authToken}`,
            "Client-ID": clientId,
          },
        }
      );
      if (response.data.data && response.data.data.length > 0) {
        return response.data.data[0].id;
      }
      logger.error(`No user found for username ${username}`);
      return null;
    } catch (error) {
      logger.error(`Failed to fetch Twitch user ID for ${username}`, error);
      return null;
    }
  }

  async subscribeToEvents() {
    if (!this.sessionId) {
      logger.error("No session ID to subscribe events.");
      return;
    }
    if (!this.authToken) {
      logger.error("No access token for subscription.");
      return;
    }
    if (!twitchUsername) {
      logger.error("No twitchUsername defined to fetch user ID.");
      return;
    }

    const twitchUserId = await this.fetchTwitchUserId(twitchUsername);
    if (!twitchUserId) {
      logger.error("Unable to get twitch user ID, abort subscribing.");
      return;
    }

    const topics = [
      `stream.online.${twitchUserId}`,
      `channel.follow.${twitchUserId}`,
      // add more topics if needed
    ];

    const subscribeMsg = {
      type: "LISTEN",
      nonce: Math.random().toString(36).substring(2, 15),
      data: {
        topics,
        auth_token: this.authToken,
      },
    };

    logger.info(`Subscribing to topics: ${topics.join(", ")}`);
    this.sendMessage(subscribeMsg);
  }

  handleNotification(payload: TwitchEvent) {
    const { subscription, event } = payload;
    switch (subscription.type) {
      case "stream.online":
        logger.info(
          `Stream online event received for user ${event.broadcaster_user_login}`
        );
        handleStreamOnline(event);
        break;

      case "channel.follow":
        logger.info(
          `New follow event received from ${event.user_login} to ${event.broadcaster_user_login}`
        );
        handleChannelFollow(event);
        break;

      default:
        logger.warn(`Unhandled event type: ${subscription.type}`);
    }
  }

  updateAuthToken(newToken: string) {
    logger.info("Updating EventSub WS auth token.");
    this.authToken = newToken;
    if (this.sessionId) {
      this.subscribeToEvents();
    }
  }
  private hasSubscribed = false;
  private async handleMessage(message: any) {
    const { metadata, payload } = message;

    if (!metadata) {
      logger.warn("Received message without metadata:", message);
      return;
    }

    switch (metadata.message_type) {
      case "session_welcome":
        this.sessionId = payload.session.id;
        logger.info(`Session established with ID: ${this.sessionId}`);

        if (!this.hasSubscribed) {
          setTimeout(() => {
            this.subscribeToEvents();
            this.hasSubscribed = true;
          }, 3000);
        }
        break;
      case "session_keepalive":
        logger.debug("Received keepalive");
        break;

      case "notification":
        logger.info(
          `Received notification for type: ${payload.subscription.type}`
        );
        this.handleNotification(payload);
        break;

      case "session_reconnect":
        logger.info("Session reconnect requested by Twitch.");
        this.ws?.close();
        break;

      case "revocation":
        logger.warn(`Subscription revoked: ${JSON.stringify(payload)}`);
        break;

      default:
        logger.debug("Unhandled message type:", metadata.message_type);
    }
  }
}

// Global instance of EventSub WS client
let twitchEventSubClient: TwitchEventSubWSClient | null = null;

// Event handlers

function handleStreamOnline(event: any) {
  logger.info(
    `[Event Handler] Stream is now ONLINE for user ${event.broadcaster_user_login}`
  );
  sendMessageToDiscord(
    `🔴 ${event.broadcaster_user_login} has gone live! Title: ${event.title}`
  );
}

function handleChannelFollow(event: any) {
  logger.info(
    `[Event Handler] New follower: ${event.user_login} followed ${event.broadcaster_user_login}`
  );
  sendMessageToDiscord(
    `👏 ${event.user_login} just followed ${event.broadcaster_user_login}!`
  );
}

// Start EventSub WebSocket client helper
function startEventSubWebSocket(username: string, token: string) {
  twitchUsername = username;
  accessToken = token;

  if (twitchEventSubClient) {
    // If client exists, update auth token and reconnect
    twitchEventSubClient.updateAuthToken(token);
  } else {
    twitchEventSubClient = new TwitchEventSubWSClient(token);
    twitchEventSubClient.connect();
  }
}

// --- Express server setup ---

export const setupServer = (commandHandler: { [key: string]: Function }) => {
  const app = express();
  app.set("trust proxy", 1);
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "frontend"));

  // Middleware to handle raw body for webhook & JSON for others
  app.use((req: any, res, next) => {
    if (req.path === "/eventsub/webhook") {
      // Skipping webhook route as per your setup
      return res.status(404).send("Not Found");
    } else {
      express.json()(req, res, next);
    }
  });

  if (process.env.NODE_ENV === "production") {
    app.use(express.static(path.join(__dirname, "frontend")));
  }

  app.use("/callback", authLimiter);

  app.get("/login", (req: Request, res: Response) => {
    const authUrl = getAuthUrl();
    logger.info(`Generated auth URL: ${authUrl}`);
    res.redirect(authUrl);
  });

  // Health check endpoint
  app.get("/health", async (req: Request, res: Response) => {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const uptime = process.uptime();

    let dbHealthy = false;
    try {
      await Channel.sequelize.authenticate();
      dbHealthy = true;
    } catch (error) {
      logger.error("DB connection failed during health check:", error);
    }

    res.status(dbHealthy ? 200 : 500).json({
      status: dbHealthy ? "ok" : "error",
      uptime,
      memory: {
        rss: memoryUsage.rss,
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system,
      },
      database: dbHealthy ? "connected" : "disconnected",
    });
  });

  app.get("/", (req: Request, res: Response) => {
    res.send("");
  });

  app.get("/callback", async (req: Request, res: Response) => {
    const { code } = req.query;
    if (!code || typeof code !== "string") {
      return res.status(400).send("Invalid code");
    }

    try {
      const tokenResponse = await axios.post(
        "https://id.twitch.tv/oauth2/token",
        null,
        {
          params: {
            client_id: clientId,
            client_secret: clientSecret,
            code,
            grant_type: "authorization_code",
            redirect_uri: redirectUri,
          },
        }
      );

      const { access_token, refresh_token, expires_in } = tokenResponse.data;
      expirationTime = new Date().getTime() + expires_in * 1000;
      accessToken = access_token;
      refreshToken = refresh_token;

      const userResponse = await axios.get(
        "https://api.twitch.tv/helix/users",
        {
          headers: {
            Authorization: `Bearer ${access_token}`,
            "Client-ID": clientId,
          },
        }
      );

      const twitchUserId = userResponse.data.data[0].id;
      twitchUsername = userResponse.data.data[0].login;

      await Channel.upsert({
        username: twitchUsername,
        access_token,
        refresh_token,
        token_expires_at: expirationTime,
        twitch_user_id: twitchUserId,
      });

      await startChatBot(twitchUsername, commandHandler);
      sendMessageToDiscord(`${twitchUsername}`);
      logger.info("Chatbot started successfully.");

      // Start EventSub WebSocket client here
      startEventSubWebSocket(twitchUsername, access_token);

      const timeLeft = expirationTime - new Date().getTime();
      const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
      const minutesLeft = Math.floor(
        (timeLeft % (1000 * 60 * 60)) / (1000 * 60)
      );
      const secondsLeft = Math.floor((timeLeft % (1000 * 60)) / 1000);
      logger.info(
        `Token expires in ${hoursLeft}h ${minutesLeft}m ${secondsLeft}s`
      );

      const refreshTime = timeLeft - 5 * 60 * 1000;
      setTimeout(
        () => refreshTokenFunction(twitchUsername!, refresh_token),
        refreshTime
      );

      res.render("auth", {
        title: "Twitch Authenticated",
        logoPath: "/logo.png",
        username: twitchUsername,
        botUsername: "FinalsRR",
      });
    } catch (error) {
      logger.error("Error during OAuth process:", error);
      res.status(500).send("Authentication failed");
    }
  });

  return app;
};
