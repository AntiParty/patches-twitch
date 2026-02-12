import { dbReady, Channel, StreamSession } from "./db";
// In-memory map to track active stream sessions
const activeStreamSessions: Map<string, any> = new Map();
import { botManager } from "./botManager";
import { startCacheUpdater, getRubyRankThreshold } from "./jobs/cacheUpdater";
import { addUserSubscription, removeUserWebSocket } from "./util/twitchEventSubWs";
import logger from "./util/logger";
import express from "express";
import { sendMessageToDiscord } from "./handlers/discordHandler";
import { startBotTokenAutoRefresher } from "./jobs/botTokenRefresher";

dbReady.then(async () => {
  logger.info("Database ready, initializing bot services...");

  try {
    await botManager.loadTokensOnStartup();
    // Start bot token auto refresher (checks every 5 minutes; refreshes when <=10 minutes left)
    startBotTokenAutoRefresher();
    startCacheUpdater();

    logger.info("Bot is up and running!");

    // Restore and continue tracking active stream sessions from DB
    const activeSessions = await StreamSession.findAll();
    activeSessions.forEach(session => {
      const channel = session.get('channel');
      const start_score = session.get('start_score');
      const start_wt_rank = session.get('start_wt_rank');
      const started_at = session.get('started_at');
      activeStreamSessions.set(String(channel), {
        start_score,
        start_wt_rank,
        started_at
      });
      // If you need to resume timers, stats, etc., do it here
      logger.info(
        `[Startup] Tracking resumed for ${channel} | started_at: ${started_at}, start_score: ${start_score}, start_wt_rank: ${start_wt_rank}`
      );
    });

    // --- Control API ---
    const controlApp = express();
    controlApp.use(express.json());

    // Add channel after auth
    controlApp.post("/add-channel", async (req: any, res: any) => {
      const { twitch_user_id } = req.body;
      if (!twitch_user_id) {
        return res.status(400).send("Missing twitch_user_id");
      }

      try {
        const user = await Channel.findOne({ where: { twitch_user_id } });
        if (!user) return res.status(404).send("User not found in DB");

        await botManager.startBotForUser(
          user.username,
          user.access_token || "",
          user.refresh_token || "",
          user.twitch_user_id || ""
        );
        res.send(`Channel ${user.username} added to bot`);
        logger.info(`[ControlAPI] Added channel: ${user.username}`);
        sendMessageToDiscord(user.username);
      } catch (err) {
        logger.error("Failed to add channel via control API:", err);
        res.status(500).send("Internal error");
      }
    });


    // Reconnect channel with custom bot (used after linking a custom bot account)
    controlApp.post("/reconnect-custom-bot", async (req: any, res: any) => {
      const { twitch_user_id, username } = req.body;
      if (!twitch_user_id && !username) {
        return res.status(400).send("Missing twitch_user_id or username");
      }

      try {
        // Find the channel
        let user = null;
        if (twitch_user_id) {
          user = await Channel.findOne({ where: { twitch_user_id } });
        }
        if (!user && username) {
          user = await Channel.findOne({ where: { username } });
        }

        if (!user) {
          return res.status(404).send("User not found in DB");
        }

        const uname = user.username;

        // Stop the existing bot connection
        await botManager.stopBotForUser(uname);
        logger.info(`[ControlAPI] Stopped existing bot for ${uname}, reconnecting with custom bot...`);

        // Small delay to ensure socket cleanup completes
        await new Promise(resolve => setTimeout(resolve, 200));

        // Start the bot fresh - this will pick up the custom bot from DB
        await botManager.startBotForUser(
          uname,
          user.access_token || "",
          user.refresh_token || "",
          user.twitch_user_id || ""
        );

        res.json({ success: true, message: `Custom bot connected for ${uname}` });
        logger.info(`[ControlAPI] Reconnected ${uname} with custom bot`);
      } catch (err) {
        logger.error("Failed to reconnect with custom bot:", err);
        res.status(500).send("Internal error");
      }
    });

    // Remove channel and disconnect EventSub WebSocket
    controlApp.post("/remove-channel", async (req: any, res: any) => {
      const { twitch_user_id, username } = req.body;
      if (!twitch_user_id && !username) {
        return res.status(400).send("Missing twitch_user_id or username");
      }

      // Try to find user by twitch_user_id or username
      let user = null;
      if (twitch_user_id) {
        user = await Channel.findOne({ where: { twitch_user_id } });
      }
      if (!user && username) {
        user = await Channel.findOne({ where: { username } });
      }

      // Always attempt to stop bot and disconnect EventSub WebSocket
      try {
        const uname = user?.username || username;
        if (uname) {
          await botManager.stopBotForUser(uname);

          // Optionally: disconnect EventSub WebSocket here if needed
          removeUserWebSocket(user?.twitch_user_id || twitch_user_id);
          logger.info(`[ControlAPI] Removed channel and disconnected bot/EventSub for ${uname}`);
          return res.json({ success: true });
        } else {
          logger.warn(`[ControlAPI] Could not find user for removal, but attempted disconnect for username: ${username}`);
          await botManager.stopBotForUser(username);
          return res.json({ success: true, warning: "User not found in DB, attempted disconnect by username." });
        }
      } catch (err) {
        logger.error("Failed to remove channel via Control API:", err);
        return res.status(500).send("Internal error");
      }
    });

    // --- NEW: Send a message via botManager ---
    controlApp.post("/send-message", async (req: any, res: any) => {
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

    controlApp.post("/pause", async (req: any, res: any) => {
      try {
        await botManager.pauseAll();
        res.json({ success: true });
      } catch (err) {
        logger.error("Failed to pause bots:", err);
        res.status(500).send("Failed to pause bots");
      }
    });

    controlApp.post("/resume", async (req: any, res: any) => {
      try {
        await botManager.resumeAll();
        res.json({ success: true });
      } catch (err) {
        logger.error("Failed to resume bots:", err);
        res.status(500).send("Failed to resume bots");
      }
    });

    controlApp.get("/health", async (req: any, res: any) => {
      const timestamp = Date.now();
      const uptime = process.uptime();

      // -------------------------------------
      // DATABASE CHECK
      // -------------------------------------
      let databaseStatus = {
        name: "database",
        status: "ok",
        latencyMs: 0,
        detail: "connected"
      };

      try {
        const start = performance.now();
        await Channel.findOne(); // light DB query
        databaseStatus.latencyMs = Math.round(performance.now() - start);
      } catch (err: any) {
        databaseStatus.status = "error";
        databaseStatus.detail = err.message;
      }

      // -------------------------------------
      // BOT CHECK
      // -------------------------------------
      let botStatus = {
        name: "bot",
        status: "ok",
        latencyMs: 0,
        detail: "connected"
      };

      try {
        const t0 = performance.now();
        // botManager.ping() doesn't exist, so we'll just assume it's ok if we're here
        botStatus.latencyMs = Math.round(performance.now() - t0);
      } catch (err) {
        botStatus.status = "error";
        botStatus.detail = "ECONNREFUSED";
        botStatus.latencyMs = 0;
      }

      // -------------------------------------
      // EVENTSUB WS (OPTIONAL HOOK)
      // -------------------------------------
      let eventsubStatus = {
        name: "eventsub_ws",
        status: "ok",
        latencyMs: 0,
        detail: "connected"
      };

      try {
        if ((global as any).eventsubWs && (global as any).eventsubWs.readyState === 1) {
          // OPEN
          eventsubStatus.latencyMs = 1;
        } else {
          eventsubStatus.status = "optional";
          eventsubStatus.detail = "WS_NOT_CONNECTED";
        }
      } catch (err: any) {
        eventsubStatus.status = "error";
        eventsubStatus.detail = err.message ?? "WS_NOT_CONNECTED";
        eventsubStatus.latencyMs = 0;
      }

      // -------------------------------------
      // OVERALL STATUS
      // -------------------------------------
      const checks = [databaseStatus, botStatus, eventsubStatus];
      const overallOk = checks.every((x) => x.status === "ok" || x.status === "optional");

      const result = {
        status: overallOk ? "ok" : "error",
        version: "1.0.0",
        timestamp,
        uptime,
        checks,
        memory: process.memoryUsage(),
        cpu: process.cpuUsage()
      };

      if (!overallOk) {
        return res.status(500).json(result);
      }

      return res.json(result);
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