import { dbReady, Channel } from "./db";
import { botManager } from "./botManager";
import { startCacheUpdater } from "./jobs/cacheUpdater";
import { addUserSubscription } from "./util/twitchEventSubWs";
import logger from "./util/logger";
import express from "express";

dbReady.then(async () => {
  logger.info("Database ready, initializing bot services...");

  try {
    await botManager.loadTokensOnStartup();
    await botManager.loadChannels();
    startCacheUpdater();

    const users = await Channel.findAll();
    users.forEach((user: any) => {
      if (user.twitch_user_id && user.access_token) {
        addUserSubscription(user.twitch_user_id, user.access_token, user.twitch_user_id);
        logger.info(`[EventSubWs] Auto-subscribed ${user.username} (${user.twitch_user_id})`);
      }
    });

    logger.info("Bot is up and running!");

    // --- Control API ---
    const controlApp = express();
    controlApp.use(express.json());

    // Add channel after auth
    controlApp.post("/add-channel", async (req, res) => {
      const { twitch_user_id } = req.body;
      if (!twitch_user_id) {
        return res.status(400).send("Missing twitch_user_id");
      }

      try {
        const user = await Channel.findOne({ where: { twitch_user_id } });
        if (!user) return res.status(404).send("User not found in DB");

        await botManager.startBotForUser(
          user.username,
          user.access_token,
          user.refresh_token,
          user.twitch_user_id
        );

        res.send(`Channel ${user.username} added to bot`);
        logger.info(`[ControlAPI] Added channel: ${user.username}`);
      } catch (err) {
        logger.error("Failed to add channel via control API:", err);
        res.status(500).send("Internal error");
      }
    });

    // --- NEW: Send a message via botManager ---
    controlApp.post("/send-message", async (req, res) => {
      const { channel, message } = req.body;
      if (!message || typeof message !== "string") {
        return res.status(400).send("Message is required");
      }

      try {
        await botManager.sendMessage(message, channel);
        res.json({ success: true, channel: channel || "all" });
        logger.info(`[ControlAPI] Sent message "${message}" to ${channel || "all channels"}`);
      } catch (err) {
        logger.error("Failed to send message via Control API:", err);
        res.status(500).send("Failed to send message");
      }
    });

    controlApp.listen(4000, () => {
      logger.info("Bot control API running on http://localhost:4000");
    });
    // --- end Control API ---

  } catch (error) {
    logger.error("Failed to initialize bot services:", error);
    process.exit(1);
  }
}).catch((error) => {
  logger.error("Database initialization failed:", error);
  process.exit(1);
});
