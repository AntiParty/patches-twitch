import express, { Request, Response, NextFunction } from "express";
import axios from "axios";
import { Channel } from "./db";
import { sendMessageToDiscord } from "./handlers/discordHandler";
import { startChatBot, reconnectChatBot } from "./util/bot";
import { loadCommands } from "./handlers/commands";
import logger from "./util/logger";
import path from "path";
import rateLimit from "express-rate-limit";
import fs from "fs";
import crypto from "crypto";
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
const eventsubSecret = process.env.TWITCH_EVENTSUB_SECRET!;
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

// --- Helper: Verify Twitch EventSub Signature ---
function verifyTwitchEventSubSignature(
  req: Request,
  secret: string
): boolean {
  try {
    const messageId = req.header("Twitch-Eventsub-Message-Id");
    const timestamp = req.header("Twitch-Eventsub-Message-Timestamp");
    const messageSignature = req.header("Twitch-Eventsub-Message-Signature");

    if (!messageId || !timestamp || !messageSignature) return false;

    const rawBody = (req as any).rawBody;
    if (!rawBody) return false;

    const hmacMessage = messageId + timestamp + rawBody;

    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(hmacMessage);
    const computedSignature = `sha256=${hmac.digest("hex")}`;

    const signatureBuffer = Buffer.from(messageSignature, "utf8");
    const computedBuffer = Buffer.from(computedSignature, "utf8");

    if (signatureBuffer.length !== computedBuffer.length) return false;

    return crypto.timingSafeEqual(signatureBuffer, computedBuffer);
  } catch {
    return false;
  }
}

// --- Dummy auth middleware: Replace with your real auth check ---
const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // TODO: Implement your actual auth check here
  const isAuthenticated = true; // Replace with real logic
  if (!isAuthenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
};

export const setupServer = (commandHandler: { [key: string]: Function }) => {
  const app = express();
  app.set("trust proxy", 1);
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "frontend"));

  // Middleware to parse JSON for all routes except /eventsub (need raw)
  app.use((req: any, res, next) => {
    if (req.path === "/eventsub") {
      // We'll parse raw body in /eventsub route
      next();
    } else {
      express.json()(req, res, next);
    }
  });

  // Production static assets
  if (process.env.NODE_ENV === "production") {
    app.use(express.static(path.join(__dirname, "frontend")));
  }

  app.use("/callback", authLimiter);

  app.get("/login", (req: Request, res: Response) => {
    const authUrl = getAuthUrl();
    logger.info(`Generated auth URL: ${authUrl}`);
    res.redirect(authUrl);
  });

  // --- EventSub webhook route ---
  app.post(
    "/eventsub",
    express.raw({ type: "application/json" }), // raw body parser needed for signature verification
    authMiddleware,
    (req: Request, res: Response) => {
      if (!verifyTwitchEventSubSignature(req, eventsubSecret)) {
        logger.warn("EventSub signature verification failed");
        // Reject quickly
        return res.status(401).send("Invalid signature");
      }

      const body = JSON.parse(req.body.toString("utf8"));
      const messageType = req.header("Twitch-Eventsub-Message-Type");
      logger.info(`EventSub message type: ${messageType}`);

      switch (messageType) {
        case "webhook_callback_verification":
          logger.info(`Responding to webhook verification challenge`);
          return res.status(200).send(body.challenge);

        case "notification":
          logger.info(
            `Received EventSub notification for subscription ID ${body.subscription.id}`
          );
          // TODO: Add your event processing logic here
          // e.g. handle body.event and update DB, send discord messages, etc.
          return res.status(200).send("OK");

        case "revocation":
          logger.warn(
            `EventSub subscription revoked: ${body.subscription.id}, reason: ${body.subscription.status}`
          );
          // TODO: Clean up subscription from DB or cache if needed
          return res.status(200).send("Revocation acknowledged");

        default:
          logger.warn(`Unknown EventSub message type: ${messageType}`);
          return res.status(400).send("Unknown message type");
      }
    }
  );

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

      // Removed EventSub subscriptions here (if needed, add after this)

      await startChatBot(twitchUsername, commandHandler);
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
        () => refreshTokenFunction(twitchUsername!, refresh_token),
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