import express, { Request, Response } from "express";
import axios from "axios";
import { Channel, dbReady, getAllUsers, getGlobalCommands, setGlobalCommandState } from "./db";
import { sendMessageToDiscord } from "./handlers/discordHandler";
import { startChatBot, reconnectChatBot } from "./util/bot";
import { connectEventSubWebSocket, addUserSubscription } from "./util/twitchEventSubWs";
import session from 'express-session';


// Ensure DB is ready before starting anything that uses Channel
(async () => {
  await dbReady;
})();
import { loadCommands } from "./handlers/commands";
import logger from "./util/logger";
import path from "path";
import rateLimit from "express-rate-limit";
import fs from "fs";
import * as dotenv from "dotenv";

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

// Track token refresh failures for rare Discord alerts
const tokenRefreshFailures: { [key: string]: number } = {};
const refreshTokenFunction = async (username: string, refreshToken: string, commandHandler: { [key: string]: Function }) => {
  if (!refreshToken) {
    logger.error(`No refresh token for ${username}`);
    sendMessageToDiscord(`Critical: No refresh token for ${username}. Manual intervention required.`);
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
    scheduleTokenRefresh(
      username,
      newRefreshToken,
      expires_in * 1000 - 5 * 60 * 1000,
      commandHandler
    );
    await reconnectChatBot(username, commandHandler);
    logger.info(`[${username}] Bot reconnected after token refresh.`);
    tokenRefreshFailures[username] = 0; // Reset on success
  } catch (error) {
    tokenRefreshFailures[username] = (tokenRefreshFailures[username] || 0) + 1;
    // Only alert on Discord if failure is rare/critical (e.g., 3 consecutive failures)
    if (tokenRefreshFailures[username] === 3 || tokenRefreshFailures[username] % 10 === 0) {
      sendMessageToDiscord(`Critical: Token refresh failed for ${username} ${tokenRefreshFailures[username]} times. Manual intervention may be required.`);
    }
    logger.error(`[${username}] Token refresh failed:`, error);
    logger.info("Retrying in 1 minute...");
  setTimeout(() => refreshTokenFunction(username, refreshToken, commandHandler), 60 * 1000);
  }
};

const scheduleTokenRefresh = (
  username: string,
  refreshToken: string,
  refreshTime: number,
  commandHandler: { [key: string]: Function }
) => {
  if (refreshTimers[username]) clearTimeout(refreshTimers[username]);

  if (refreshTime > 0) {
    refreshTimers[username] = setTimeout(
      () => refreshTokenFunction(username, refreshToken, commandHandler),
      refreshTime
    );
  } else {
    setTimeout(() => refreshTokenFunction(username, refreshToken, commandHandler), 60 * 1000);
  }
};

export const validateToken = async (
  username: string,
  accessToken: string,
  refreshToken: string,
  commandHandler: { [key: string]: Function }
) => {
  try {
    const response = await axios.get("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const expiresIn = response.data.expires_in;
    scheduleTokenRefresh(
      username,
      refreshToken,
      expiresIn * 1000 - 5 * 60 * 1000,
      commandHandler
    );
  } catch (error) {
    logger.error(`[${username}] Token validation failed. Refreshing now...`);
    refreshTokenFunction(username, refreshToken, commandHandler);
  }
};

const validateAllTokens = async (commandHandler: { [key: string]: Function }) => {
  const channels = await Channel.findAll();

  for (const channel of channels) {
    const { username, access_token, refresh_token, token_expires_at } = channel;
    if (access_token && refresh_token && token_expires_at) {
      const timeLeft =
        new Date(token_expires_at).getTime() - new Date().getTime();
      if (timeLeft > 0) {
        await validateToken(username, access_token, refresh_token, commandHandler);
      } else {
        logger.info(`Token for ${username} has expired. Refreshing...`);
        await refreshTokenFunction(username, refresh_token, commandHandler);
      }
    } else {
      logger.warn(`No tokens found for ${username}, skipping...`);
    }
  }
};

const startTokenValidationInterval = (commandHandler: { [key: string]: Function }) => {
  const intervalTime = 15 * 1000;
  setInterval(() => validateAllTokens(commandHandler), intervalTime);
  logger.info(
    `Started periodic token validation every ${intervalTime / 1000} seconds.`
  );
};

export const loadTokensOnStartup = async (commandHandler: { [key: string]: Function }) => {
  logger.info("Loading stored tokens...");
  await validateAllTokens(commandHandler);
  startTokenValidationInterval(commandHandler);
};

export const setupServer = (commandHandler: { [key: string]: Function }) => {
  // Start EventSub WebSocket connection
  connectEventSubWebSocket();

  // Auto-subscribe all users on startup
  import('./db').then(async ({ Channel }) => {
    const users = await Channel.findAll();
    users.forEach((user: any) => {
      if (user.twitch_user_id && user.access_token) {
        addUserSubscription(user.twitch_user_id, user.access_token, user.twitch_user_id);
        logger.info(`[EventSubWs] Auto-subscribed ${user.username} (${user.twitch_user_id})`);
      }
    });
  });
  const app = express();
  app.set("trust proxy", 1);
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "frontend"));

  // Use JSON middleware for all routes
  app.use(express.json());

  app.use(express.static(path.join(__dirname, "frontend")));

  app.use("/callback", authLimiter);

  app.get("/login", (req: Request, res: Response) => {
    const authUrl = getAuthUrl();
    logger.info(`Generated auth URL: ${authUrl}`);
    res.redirect(authUrl);
  });

  // Start EventSub WebSocket connection
  connectEventSubWebSocket();
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
      // Alert only if DB is persistently down (rare case)
      if (!globalThis.__dbDownAlerted) {
        sendMessageToDiscord("Critical: Database connection failed during health check. Manual intervention required.");
        globalThis.__dbDownAlerted = true;
      }
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
  res.sendFile(path.join(__dirname, "frontend", "index.html"));
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

  // Subscribe user to EventSub via WebSocket after authentication
  addUserSubscription(twitchUserId, access_token, twitchUserId);

      await startChatBot(twitchUsername || '', commandHandler);
      sendMessageToDiscord(`${twitchUsername}`);
      logger.info("Chatbot started successfully.");

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
        () => refreshTokenFunction(twitchUsername!, refresh_token, commandHandler),
        refreshTime
      );

      res.render("auth", {
        title: "Twitch Authenticated",
        logoPath: "/logo.png", // relative to your static folder
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