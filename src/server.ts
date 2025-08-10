import express, { Request, Response } from "express";
import axios from "axios";
import { Channel } from "./db";
import { sendMessageToDiscord } from "./handlers/discordHandler";
import { startChatBot } from "./util/bot";
import { loadCommands } from "./handlers/commands";
import logger from "./util/logger";
import path from "path";
import rateLimit from "express-rate-limit";
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

export const setupServer = (commandHandler: { [key: string]: Function }) => {
  const app = express();
  app.set("trust proxy", 1);
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "frontend"));

  app.use(express.json());

  if (process.env.NODE_ENV === "production") {
    app.use(express.static(path.join(__dirname, "frontend")));
  }

  app.use("/callback", authLimiter);

  app.get("/login", (req: Request, res: Response) => {
    const authUrl = getAuthUrl();
    logger.info(`Generated auth URL: ${authUrl}`);
    res.redirect(authUrl);
  });

  // Remove /eventsub webhook & status routes completely

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
      // Get access token from Twitch
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
      const expirationTime = new Date().getTime() + expires_in * 1000;

      // Get user info from Twitch
      const userResponse = await axios.get("https://api.twitch.tv/helix/users", {
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Client-ID": clientId,
        },
      });

      const twitchUserId = userResponse.data.data[0].id;
      const twitchUsername = userResponse.data.data[0].login;

      await Channel.upsert({
        username: twitchUsername,
        access_token,
        refresh_token,
        token_expires_at: expirationTime,
        twitch_user_id: twitchUserId,
      });

      // Start chatbot but no EventSub subscriptions here
      await startChatBot(twitchUsername, commandHandler);
      sendMessageToDiscord(`${twitchUsername}`);
      logger.info("Chatbot started successfully.");

      // Log token expiration
      const timeLeft = expirationTime - new Date().getTime();
      const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
      const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
      const secondsLeft = Math.floor((timeLeft % (1000 * 60)) / 1000);
      logger.info(
        `Token expires in ${hoursLeft}h ${minutesLeft}m ${secondsLeft}s`
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