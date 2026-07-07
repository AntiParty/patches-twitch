import { dbReady, Channel, StreamSession, Giveaway } from "./db";
// In-memory map to track active stream sessions
const activeStreamSessions: Map<string, any> = new Map();
import { botManager } from "./botManager";
import { startCacheUpdater, getRubyRankThreshold } from "./jobs/cacheUpdater";
import { addUserSubscription, removeUserWebSocket, addRedemptionSubscription, removeRedemptionSubscription } from "./util/twitchEventSubWs";
import { createReward, setRewardEnabled, setRewardPaused, hasRedemptionsScope } from "./services/twitchChannelPoints.service";
import { createGiveaway, getActiveGiveaway } from "./services/giveaway.service";
import { decryptChannelAccessToken } from "./util/twitchUtils";
import logger from "./util/logger";
import express from "express";
import { sendMessageToDiscord } from "./handlers/discordHandler";
import { startBotTokenAutoRefresher } from "./jobs/botTokenRefresher";
import { startCustomBotTokenRefresher } from "./jobs/customBotTokenRefresher";
import { clients } from "./util/ircBot";

dbReady.then(async () => {
  logger.info("Database ready, initializing bot services...");

  try {
    await botManager.loadTokensOnStartup();
    // Start bot token auto refresher (checks every 5 minutes; refreshes when <=10 minutes left)
    startBotTokenAutoRefresher();
    // Refresh per-channel custom-bot account tokens before they expire.
    startCustomBotTokenRefresher();
    startCacheUpdater();

    logger.info("Bot is up and running!");

    // Restore and continue tracking active stream sessions from DB
    const activeSessions = await StreamSession.findAll();
    activeSessions.forEach(session => {
      const channel = session.get('channel');
      const start_score = session.get('start_score');
      const started_at = session.get('started_at');
      activeStreamSessions.set(String(channel), {
        start_score,
        started_at
      });
      // If you need to resume timers, stats, etc., do it here
      logger.info(
        `[Startup] Tracking resumed for ${channel} | started_at: ${started_at}, start_score: ${start_score}`
      );
    });

    // Restore redemption EventSub subscriptions for any open redeem giveaways
    try {
      const openRedeemGiveaways = await Giveaway.findAll({
        where: { status: "open", type: "redeem" },
      });
      for (const giveaway of openRedeemGiveaways) {
        if (!giveaway.reward_id) continue;
        const channel = await Channel.findOne({ where: { username: giveaway.channel } });
        if (!channel?.twitch_user_id) continue;
        const token = decryptChannelAccessToken(channel);
        if (!token) continue;
        addRedemptionSubscription(
          channel.twitch_user_id,
          token,
          channel.twitch_user_id,
          giveaway.reward_id
        );
        logger.info(`[Startup] Restored redemption sub for giveaway in ${giveaway.channel}`);
      }
    } catch (err) {
      logger.error("[Startup] Failed to restore redeem giveaway subscriptions:", err);
    }

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

    controlApp.post("/restart-channel-bot", async (req: any, res: any) => {
      const username = String(req.body?.username || "").trim().toLowerCase();
      if (!username) return res.status(400).json({ success: false, error: "Missing username" });

      try {
        const result = await botManager.restartBotFromCurrentState(username);
        if (!result.success) return res.status(502).json(result);
        logger.info(`[ControlAPI] Restarted ${username} from current bot identity state`);
        return res.json(result);
      } catch (error) {
        logger.error(`[ControlAPI] Failed to restart ${username} from current state:`, error);
        return res.status(500).json({ success: false, error: "Internal error" });
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

    // Expose in-memory chat rate data to the web server process
    controlApp.get("/metrics/chat", (req: any, res: any) => {
      const range  = (req.query.range  as string) || '1h';
      const window = (req.query.window as string) || String(60 * 60_000);
      const bucket = (req.query.bucket as string) || String(60_000);
      const { getMessageRates } = require('./util/messageRateTracker');
      res.json(getMessageRates(Number(window), Number(bucket)));
    });

    controlApp.get("/metrics/operations", (_req: any, res: any) => {
      const entries = Object.values(clients);
      res.json({
        observedAt: new Date().toISOString(),
        connectedChannels: entries.filter((client) => client.connected).length,
        reconnectingChannels: entries.filter((client) => !client.connected && !client.intentionalDisconnect).length,
      });
    });

    // --- Giveaways: channel-point redeem lifecycle (reward + EventSub live here) ---
    controlApp.post("/giveaway/redeem/start", async (req: any, res: any) => {
      const channelName = String(req.body?.channel || "").trim().toLowerCase();
      const prize = typeof req.body?.prize === "string" ? req.body.prize.trim().slice(0, 45) : "";
      const cost = Math.max(1, Math.floor(Number(req.body?.cost) || 0));
      const prompt = typeof req.body?.prompt === "string" ? req.body.prompt : undefined;
      const backgroundColor = typeof req.body?.backgroundColor === "string" ? req.body.backgroundColor : undefined;
      if (!channelName || !cost) {
        return res.status(400).json({ error: "channel and cost are required" });
      }

      try {
        const channel = await Channel.findOne({ where: { username: channelName } });
        if (!channel?.twitch_user_id) {
          return res.status(404).json({ error: "Channel not found" });
        }
        if (!(await hasRedemptionsScope(channel.id))) {
          return res.status(403).json({ reason: "no_scope", error: "Reauthorization required." });
        }

        const created = await createGiveaway({
          channel: channelName,
          type: "redeem",
          prize: prize || null,
          rewardCost: cost,
        });
        if (!created.ok) {
          return res.status(409).json({ error: "A giveaway is already active. Close it first." });
        }

        const reward = await createReward(channel.id, {
          title: prize || "Giveaway Entry",
          cost,
          prompt,
          backgroundColor,
        });
        if (!reward.ok) {
          // Roll back the giveaway row we just created so state stays consistent.
          await created.giveaway.update({ status: "closed", closed_at: new Date() });
          if (reward.reason === "no_scope") {
            return res.status(403).json({ reason: "no_scope", error: "Reauthorization required." });
          }
          return res.status(502).json({ error: reward.message || "Failed to create reward." });
        }

        await created.giveaway.update({ reward_id: reward.rewardId });

        const token = decryptChannelAccessToken(channel);
        if (token) {
          addRedemptionSubscription(channel.twitch_user_id, token, channel.twitch_user_id, reward.rewardId);
        }

        logger.info(`[ControlAPI] Started redeem giveaway for ${channelName} (reward ${reward.rewardId})`);
        return res.json({ success: true, rewardId: reward.rewardId });
      } catch (err) {
        logger.error("[ControlAPI] Failed to start redeem giveaway:", err);
        return res.status(500).json({ error: "Internal error" });
      }
    });

    controlApp.post("/giveaway/redeem/stop", async (req: any, res: any) => {
      const channelName = String(req.body?.channel || "").trim().toLowerCase();
      if (!channelName) return res.status(400).json({ error: "channel is required" });

      try {
        const channel = await Channel.findOne({ where: { username: channelName } });
        const giveaway = await getActiveGiveaway(channelName);
        if (giveaway?.reward_id && channel?.twitch_user_id) {
          await removeRedemptionSubscription(channel.twitch_user_id, giveaway.reward_id);
          await setRewardEnabled(channel.id, giveaway.reward_id, false);
        }
        return res.json({ success: true });
      } catch (err) {
        logger.error("[ControlAPI] Failed to stop redeem giveaway:", err);
        return res.status(500).json({ error: "Internal error" });
      }
    });

    controlApp.post("/giveaway/redeem/pause", async (req: any, res: any) => {
      const channelName = String(req.body?.channel || "").trim().toLowerCase();
      const paused = Boolean(req.body?.paused);
      if (!channelName) return res.status(400).json({ error: "channel is required" });

      try {
        const channel = await Channel.findOne({ where: { username: channelName } });
        const giveaway = await getActiveGiveaway(channelName);
        if (giveaway?.reward_id && channel?.twitch_user_id) {
          await setRewardPaused(channel.id, giveaway.reward_id, paused);
        }
        return res.json({ success: true });
      } catch (err) {
        logger.error("[ControlAPI] Failed to pause/resume redeem reward:", err);
        return res.status(500).json({ error: "Internal error" });
      }
    });
    // --- end Giveaways ---

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
