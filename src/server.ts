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
    scheduleTokenRefresh(
      username,
      newRefreshToken,
      expires_in * 1000 - 5 * 60 * 1000
    );
    await reconnectChatBot(username, commandHandler);
    logger.info(`[${username}] Bot reconnected after token refresh.`);
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

export const setupServer = (commandHandler: { [key: string]: Function }) => {
  const app = express();
  app.set("trust proxy", 1);
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "frontend"));

  // This middleware handles the raw body for the webhook and JSON for all other routes.
  app.use((req: any, res, next) => {
    if (req.path === "/eventsub/webhook") {
      // Removed eventsub webhook route, just skip parsing for now
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

  // Removed /eventsub/webhook and /eventsub/status routes entirely

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

  // GET /callback: Twitch OAuth code exchange
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
            client_id: process.env.TWITCH_CLIENT_ID,
            client_secret: process.env.TWITCH_CLIENT_SECRET,
            code,
            grant_type: "authorization_code",
            redirect_uri: process.env.BASE_CALLBACK_URL,
          },
        }
      );
      const { access_token, refresh_token, expires_in } = tokenResponse.data;
      const userResponse = await axios.get(
        "https://api.twitch.tv/helix/users",
        {
          headers: {
            Authorization: `Bearer ${access_token}`,
            "Client-ID": process.env.TWITCH_CLIENT_ID,
          },
        }
      );
      const twitchUserId = userResponse.data.data[0].id;
      const twitchUsername = userResponse.data.data[0].login;
      await Channel.upsert({
        username: twitchUsername,
        access_token,
        refresh_token,
        token_expires_at: new Date().getTime() + expires_in * 1000,
        twitch_user_id: twitchUserId,
      });
      await startChatBot(twitchUsername, commandHandler);
      logger.info(`Chatbot started for ${twitchUsername}`);
      res.render("auth", {
        title: "Twitch Authenticated",
        logoPath: "/logo.png",
        username: twitchUsername,
        botUsername: "FinalsRR",
      });
    } catch (error) {
      logger.error("OAuth error:", error);
      res.status(500).send("Authentication failed");
    }
  });

  // POST /callback: Twitch EventSub webhook
  app.post("/callback", express.raw({ type: "application/json" }), (req: Request, res: Response) => {
    const messageId = req.header("Twitch-Eventsub-Message-Id");
    const timestamp = req.header("Twitch-Eventsub-Message-Timestamp");
    const signature = req.header("Twitch-Eventsub-Message-Signature");
    const secret = process.env.TWITCH_EVENTSUB_SECRET;
    const body = req.body;
    // Verify signature
    const crypto = require("crypto");
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(messageId + timestamp + body);
    const expectedSig = "sha256=" + hmac.digest("hex");
    if (signature !== expectedSig) {
      logger.warn("Invalid EventSub signature");
      return res.status(403).send("Forbidden");
    }
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return res.status(400).send("Invalid JSON");
    }
    // Respond to webhook verification
    if (payload.challenge) {
      return res.status(200).send(payload.challenge);
    }
    // Handle stream.online and stream.offline
    if (payload.subscription && payload.event) {
      const type = payload.subscription.type;
      if (type === "stream.online" || type === "stream.offline") {
        logger.info(`EventSub: ${type} for user ${payload.event.broadcaster_user_id}`);
      }
    }
    res.status(200).end();
  });

  // POST /subscribe: Register EventSub subscriptions for multiple users
  app.post("/subscribe", express.json(), async (req: Request, res: Response) => {
    const { userIds } = req.body;
    if (!Array.isArray(userIds)) {
      return res.status(400).send("userIds must be an array");
    }
    const callbackUrl = process.env.BASE_CALLBACK_URL;
    const secret = process.env.TWITCH_EVENTSUB_SECRET;
    const clientId = process.env.TWITCH_CLIENT_ID;
    const accessToken = process.env.TWITCH_APP_ACCESS_TOKEN;
    const results = [];
    for (const userId of userIds) {
      for (const type of ["stream.online", "stream.offline"]) {
        try {
          const resp = await axios.post(
            "https://api.twitch.tv/helix/eventsub/subscriptions",
            {
              type,
              version: "1",
              condition: { broadcaster_user_id: userId },
              transport: {
                method: "webhook",
                callback: callbackUrl,
                secret,
              },
            },
            {
              headers: {
                "Client-ID": clientId,
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
            }
          );
          results.push({ userId, type, status: "subscribed" });
        } catch (err) {
          logger.error(`Failed to subscribe ${userId} to ${type}:`, err);
          results.push({ userId, type, status: "error" });
        }
      }
    }
    res.json({ results });
  });

  return app;
};
