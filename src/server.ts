import express, { Request, Response } from "express";
import client from 'prom-client';
import axios from "axios";
import { Channel, dbReady, getAllUsers, getGlobalCommands, setGlobalCommandState } from "./db";
import { sendMessageToDiscord, sendChangelogToDiscord } from "./handlers/discordHandler";
import { startChatBot, reconnectChatBot } from "./util/bot";
import { addUserSubscription } from "./util/twitchEventSubWs";
import session from 'express-session';


// Ensure DB is ready before starting anything that uses Channel
(async () => {
  await dbReady;
})();
import { loadCommands } from "./handlers/commands";

// Initialize commandHandler at startup
const commandHandler = loadCommands();
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

// Prometheus metrics setup
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics();

// Custom metrics
export const commandCounter = new client.Counter({
  name: 'twitchbot_command_total',
  help: 'Total number of commands received',
  labelNames: ['command']
});

const statsFilePath = path.join(process.cwd(), "stats.json");
let commandsProcessed = 0;
export function incrementCommandsProcessed() {
  commandsProcessed++;
}
export function getCommandsProcessed() {
  return commandsProcessed;
}
const serverStartTime = Date.now();

const apiErrorCounter = new client.Counter({
  name: 'twitchbot_api_errors_total',
  help: 'Total number of API errors',
  labelNames: ['endpoint']
});

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

function exportStatsToJson() {
  Channel.count().then(userCount => {
    const uptime = Math.floor((Date.now() - serverStartTime) / 1000);
    const stats = {
      userCount,
      commandsProcessed,
      uptime
    };
    fs.writeFile(statsFilePath, JSON.stringify(stats, null, 2), err => {
      if (err) logger.error("Failed to write stats.json:", err);
      else logger.info("Exported stats.json");
    });
  });
}

const startTokenValidationInterval = (commandHandler: { [key: string]: Function }) => {
  const intervalTime = 15 * 1000;
  setInterval(() => validateAllTokens(commandHandler), intervalTime);
  logger.info(
    `Started periodic token validation every ${intervalTime / 1000} seconds.`
  );
};

/**
 * Loads stored tokens from the database and starts validation interval.
 * @param commandHandler - Object containing command handler functions
 */
export const loadTokensOnStartup = async (commandHandler: { [key: string]: Function }) => {
  logger.info("Loading stored tokens...");
  await validateAllTokens(commandHandler);
  startTokenValidationInterval(commandHandler);
};

/**
 * Sets up the Express server, API endpoints, and EventSub WebSocket connection.
 * @param commandHandler - Object containing command handler functions
 * @returns Express app instance
 */
export const setupServer = () => {
  // Use the initialized commandHandler
  const handler = commandHandler;
  const frontendPath = path.join(process.cwd(), "frontend");
  const app = express();
  app.set("trust proxy", 1);
  app.set("view engine", "ejs");
  app.set("views", frontendPath);

  // Use JSON middleware for all routes
  app.use(express.json());

  app.use(express.static(frontendPath));

  app.use("/callback", authLimiter);

  // Prometheus metrics endpoint
  app.get('/metrics', async (req: Request, res: Response) => {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
  });
  // Start EventSub WebSocket connection
  // connectEventSubWebSocket is obsolete; handled per-user

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

  /**
   * GET /login
   * Redirects user to Twitch authentication URL.
   */
  app.get("/login", (req: Request, res: Response) => {
    const authUrl = getAuthUrl();
    logger.info(`Generated auth URL: ${authUrl}`);
    res.redirect(authUrl);
  });

  /**
   * POST /changelog
   * requires x-api-key header
   */

  app.post("/changelog", async (req: Request, res: Response) => {
    try {
      const apiKey = req.headers['x-api-key'];
      console.log('Received API Key:', apiKey);
      if (apiKey !== process.env.API_KEY) {
        logger.info(`ENV API Key: ${process.env.API_KEY}`);
        logger.info(`Received API Key: ${apiKey}`);
        return res.status(403).json({ error: "Forbidden" });
      }

      const { title, categories } = req.body;
      if (!title || !categories || typeof categories !== 'object') {
        return res.status(400).json({ error: "Title and categories are required" });
      }

      await sendChangelogToDiscord(title, categories);

      logger.info("Changelog sent to Discord successfully.");
      res.status(200).json({ message: "Changelog sent successfully" });
    } catch (error) {
      logger.error("Error sending changelog to Discord:", error);
      res.status(500).json({ error: "Failed to send changelog" });
    }
  });

  // Start EventSub WebSocket connection
  // connectEventSubWebSocket is obsolete; handled per-user
  /**
   * GET /health
   * Returns health status of the server and database.
   */
  app.get("/health", async (req: Request, res: Response) => {
    let dbHealthy = false;
    // Check DB health first
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

    // Example: increment API error counter on DB failure
    if (!dbHealthy) {
      apiErrorCounter.inc({ endpoint: '/health' });
    }
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const uptime = process.uptime();

    // Get version from package.json
    const { version } = require("../package.json");
    res.status(dbHealthy ? 200 : 500).json({
      status: dbHealthy ? "ok" : "error",
      version,
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
    res.sendFile(path.join(frontendPath, "index.html"));
  });

  app.get("/users", async (req: Request, res: Response) => {
    try {
      const { key } = req.query;

      if (!key || key !== process.env.API_KEY) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const count = await Channel.count();
      res.status(200).json({ userCount: count });
    } catch (error) {
      logger.error("Error fetching users:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  app.get("/stats.json", (req: Request, res: Response) => {
    fs.readFile(statsFilePath, "utf8", (err, data) => {
      if (err) return res.status(500).json({ error: "Stats not available" });
      res.setHeader("Content-Type", "application/json");
      res.send(data);
    });
  });
  // domain to use: localhost:3000/users?key=GjYJB2Vm%2CKm%26*BSy3bFKVDRgvULgk

  /**
   * GET /callback
   * Handles Twitch OAuth callback, stores tokens, subscribes user, and starts chatbot.
   */
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

      await startChatBot(twitchUsername || '', handler);
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
        () => refreshTokenFunction(twitchUsername!, refresh_token, handler),
        refreshTime
      );

      res.render("auth", {
        title: "Twitch Authenticated",
        logoPath: "/assets/logo.png", // relative to your static folder
        username: twitchUsername,
        botUsername: "FinalsRR",
      });
    } catch (error) {
      apiErrorCounter.inc({ endpoint: '/callback' });
      logger.error("Error during OAuth process:", error);
      res.status(500).send("Authentication failed");
    }
  });

  return app;
};