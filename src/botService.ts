import fs from "fs";
import http from "http";
import path from "path";
import { dbReady, sequelize, Channel, StreamSession, Giveaway, CustomBotAccount } from "./db";
import { sequelizeMetrics } from "./dbMetrics";
import { sequelizeBalance } from "./dbBalance";
import { installCrashHandlers, installShutdownHandlers, onShutdown } from "./util/processLifecycle";
import { getMessageRates } from "./util/messageRateTracker";
import { botManager } from "./botManager";
import { startCacheUpdater, getRubyRankThreshold } from "./jobs/cacheUpdater";
import { removeUserWebSocket } from "./util/twitchEventSubWs";
import { CONDUIT_SHARD_COUNT, channelEvents, getConduitRuntime, startConduitRuntime } from "./eventsub/conduitRuntime";
import { conduitHealthCheck } from "./eventsub/conduitHealth";
import { channelsOnTransport } from "./chat/activeTransport";
import { countConnectedChannels } from "./chat/connectedChannels";
import { chatDispatchErrorCount, commandCooldownHitCount } from "./chat/chatDispatcher";
import { chatSendLimiter } from "./util/chatSendLimiter";
import { eventsubFallbackCount } from "./chat/chatTransportSwitch";
import { createReward, deleteReward, getRewardDiagnostics, getRewardSnapshot, setRewardPaused, updateReward, checkRedemptionsScope } from "./services/twitchChannelPoints.service";
import { createGiveaway, getActiveGiveaway, resetEntries } from "./services/giveaway.service";
import { replaceRewardForNextRound } from "./services/giveawayRoundReward.service";
import { decryptChannelAccessToken, clearCustomBotPermanentFailed } from "./util/twitchUtils";
import logger from "./util/logger";
import express from "express";
import crypto from "crypto";
import { sendMessageToDiscord } from "./handlers/discordHandler";
import { startBotTokenAutoRefresher } from "./jobs/botTokenRefresher";
import { startCustomBotTokenRefresher } from "./jobs/customBotTokenRefresher";
import { clients, loadChatReadinessCache } from "./util/ircBot";
import { Op } from "sequelize";
import { restoreGiveawayRedemptionSubscriptions } from "./services/giveawaySubscriptionRestore.service";
import { startGiveawayRedemptionReconciler } from "./jobs/giveawayRedemptionReconciler";
import { startProcessMetricsRecorder } from "./jobs/processMetricsRecorder";
import { balanceDbReady } from './dbBalance';
import { startPatchNotesWatcher } from "./jobs/patchNotesWatcher";

installCrashHandlers();
installShutdownHandlers();

// Read once; /health reports it.
const appVersion: string = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")).version ?? "unknown";
  } catch {
    return "unknown";
  }
})();

// Registered before any other hook: hooks run in reverse order, so the databases close last.
onShutdown('databases', async () => {
  await Promise.allSettled([sequelize.close(), sequelizeMetrics.close(), sequelizeBalance.close()]);
});

// Set once startup has finished joining channels; /health reports "starting" until then.
let startupComplete = false;
// Set by /pause, cleared by /resume; a deliberate pause must not read as an outage in /health.
let botsPaused = false;

const botControlSecret = process.env.BOT_CONTROL_SECRET ?? '';
if (!botControlSecret) {
  throw new Error('BOT_CONTROL_SECRET is required to start the bot control API');
}

function hasValidBotControlSecret(provided: string | undefined): boolean {
  if (!provided) return false;
  const expectedHash = crypto.createHash('sha256').update(botControlSecret).digest();
  const providedHash = crypto.createHash('sha256').update(provided).digest();
  return crypto.timingSafeEqual(expectedHash, providedHash);
}

dbReady.then(async () => {
  logger.info("Database ready, initializing bot services...");

  try {
    // --- Control API ---
    const controlApp = express();
    controlApp.use(express.json());
    controlApp.use((req, res, next): void => {
      if (!hasValidBotControlSecret(req.header('x-bot-control-secret'))) {
        logger.warn(`[ControlAPI] Unauthorized request from ${req.ip}`);
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      next();
    });

    // Add channel after auth
    controlApp.post("/add-channel", async (req: any, res: any) => {
      const { twitch_user_id, is_new } = req.body;
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
        // check if already in db, if so dont send discord message, if not send discord message
        if (is_new) {
          sendMessageToDiscord(user.username);
          logger.info(`[ControlAPI] Sent Discord notification for new channel: ${user.username}`);
        }
        //Where the event fires to discord
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

        // A re-link reuses the same CustomBotAccount row (bot_twitch_user_id is
        // unique), but a prior revocation may have left that row id in this
        // process's permanent-failed set — which would block every future
        // refresh of the new tokens until a restart. Clear it before starting.
        const customBot = await CustomBotAccount.findOne({
          where: { channel_id: user.id, is_active: true },
        });
        if (customBot) {
          clearCustomBotPermanentFailed(customBot.id);
        }

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

    // Switch a channel's chat transport without a gap: the new transport is activated before the old is retired.
    controlApp.post("/switch-chat-transport", async (req: any, res: any) => {
      const channel = String(req.body?.channel || "").trim().toLowerCase();
      const transport = String(req.body?.transport || "");
      if (!channel || (transport !== "irc" && transport !== "eventsub")) {
        return res.status(400).json({ success: false, error: "Need channel and transport ('irc' or 'eventsub')" });
      }
      try {
        const result = await botManager.switchChatTransport(channel, transport);
        if (result.status === "not_found") return res.status(404).json({ success: false, error: "Unknown channel" });
        if (result.status === "invalid") return res.status(400).json({ success: false, error: "Invalid input" });
        logger.info(`[ControlAPI] Switched ${channel} to ${transport}; active transport is ${result.active}`);
        return res.json({ success: true, active: result.active });
      } catch (error) {
        logger.error(`[ControlAPI] Failed to switch ${channel} to ${transport}:`, error);
        return res.status(500).json({ success: false, error: "Internal error" });
      }
    });

    // Remove channel and disconnect EventSub WebSocket
    controlApp.post("/remove-channel", async (req: any, res: any) => {
      const { twitch_user_id, username } = req.body;
      if (!twitch_user_id && !username) {
        return res.status(400).send("Missing twitch_user_id or username");
      }

      // Always attempt to stop bot and disconnect EventSub WebSocket
      try {
        // Try to find user by twitch_user_id or username
        let user = null;
        if (twitch_user_id) {
          user = await Channel.findOne({ where: { twitch_user_id } });
        }
        if (!user && username) {
          user = await Channel.findOne({ where: { username } });
        }

        const uname = user?.username || username;
        if (uname) {
          await botManager.stopBotForUser(uname);

          // Drops the conduit subscriptions and any per-user EventSub socket.
          if (user) await channelEvents.removeAll(user);
          else removeUserWebSocket(twitch_user_id);
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
        botsPaused = true;
        res.json({ success: true });
      } catch (err) {
        logger.error("Failed to pause bots:", err);
        res.status(500).send("Failed to pause bots");
      }
    });

    controlApp.post("/resume", async (req: any, res: any) => {
      try {
        await botManager.resumeAll();
        botsPaused = false;
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
        detail: "starting"
      };

      if (startupComplete) {
        try {
          const t0 = performance.now();
          const runtime = getConduitRuntime();
          const connected = countConnectedChannels({
            ircClients: Object.values(clients),
            eventsubChannels: channelsOnTransport('eventsub'),
            conduitShardsAssigned: runtime?.shardsAssigned() ?? 0,
          });
          // Enabled, non-revoked channels are the ones the bot should be in. DEV_CHANNELS narrows this in development, like BotManager.
          const expectedWhere: any = { bot_enabled: true, auth_revoked: false };
          if (process.env.NODE_ENV === 'development' && process.env.DEV_CHANNELS) {
            const allowed = process.env.DEV_CHANNELS.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
            if (allowed.length > 0) expectedWhere.username = { [Op.in]: allowed };
          }
          const expected = await Channel.count({ where: expectedWhere });
          botStatus.detail = `${connected}/${expected} channels connected`;
          if (botsPaused) botStatus.detail = `paused (${botStatus.detail})`;
          else if (expected > 0 && connected === 0) botStatus.status = "error";
          else if (connected < expected) botStatus.status = "degraded";
          botStatus.latencyMs = Math.round(performance.now() - t0);
        } catch (err: any) {
          botStatus.status = "error";
          botStatus.detail = err?.message || "bot check failed";
        }
      }

      // -------------------------------------
      // EVENTSUB CONDUIT
      // -------------------------------------
      const eventsubStatus = conduitHealthCheck(getConduitRuntime(), CONDUIT_SHARD_COUNT);

      // -------------------------------------
      // OVERALL STATUS
      // -------------------------------------
      const checks = [databaseStatus, botStatus, eventsubStatus];
      // A degraded conduit still has the IRC fallback, so it doesn't fail /health.
      const overallOk = checks.every((x) => x.status === "ok" || x.status === "optional" || x.status === "degraded");

      const result = {
        status: overallOk ? "ok" : "error",
        version: appVersion,
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
      const window = (req.query.window as string) || String(60 * 60_000);
      const bucket = (req.query.bucket as string) || String(60_000);
      res.json(getMessageRates(Number(window), Number(bucket)));
    });

    controlApp.get("/metrics/operations", (_req: any, res: any) => {
      const entries = Object.values(clients);
      const runtime = getConduitRuntime();
      res.json({
        observedAt: new Date().toISOString(),
        connectedChannels: countConnectedChannels({
          ircClients: entries,
          eventsubChannels: channelsOnTransport('eventsub'),
          conduitShardsAssigned: runtime?.shardsAssigned() ?? 0,
        }),
        reconnectingChannels: entries.filter((client) => !client.connected && !client.intentionalDisconnect).length,
        conduitEnabled: Boolean(runtime),
        conduitShardsAssigned: runtime?.shardsAssigned() ?? 0,
        conduitShardCount: CONDUIT_SHARD_COUNT,
        channelsByActiveTransport: {
          irc: channelsOnTransport('irc').length,
          eventsub: channelsOnTransport('eventsub').length,
        },
        conduitSubscriptionsEnabled: runtime?.registry.enabledCount() ?? 0,
        conduitSubscriptionsFailed: runtime?.registry.failedCount() ?? 0,
        conduitReconnects: runtime?.reconnects() ?? 0,
        eventsubFallbacks: eventsubFallbackCount(),
        chatDispatchErrors: chatDispatchErrorCount(),
        chatSends: chatSendLimiter.stats(),
        commandCooldownHits: commandCooldownHitCount(),
      });
    });

    // --- Giveaways: channel-point redeem lifecycle (reward + EventSub live here) ---
    controlApp.post("/giveaway/redeem/start", async (req: any, res: any) => {
      const channelName = String(req.body?.channel || "").trim().toLowerCase();
      const prize = typeof req.body?.prize === "string" ? req.body.prize.trim().slice(0, 45) : "";
      const cost = Math.max(1, Math.floor(Number(req.body?.cost) || 0));
      const prompt = typeof req.body?.prompt === "string" ? req.body.prompt : undefined;
      const backgroundColor = typeof req.body?.backgroundColor === "string" ? req.body.backgroundColor : undefined;
      const winnerCount = Math.max(1, Math.min(50, Math.floor(Number(req.body?.winnerCount) || 1)));
      // Optional Twitch-enforced limits; anything below 1 or non-numeric means "no limit".
      const parseLimit = (v: any): number | undefined => {
        const n = Math.floor(Number(v));
        return Number.isFinite(n) && n >= 1 ? n : undefined;
      };
      const maxPerUserPerStream = parseLimit(req.body?.maxPerUserPerStream);
      const maxPerStream = parseLimit(req.body?.maxPerStream);
      const cooldownSeconds = parseLimit(req.body?.cooldownSeconds);
      if (!channelName || !cost) {
        return res.status(400).json({ error: "channel and cost are required" });
      }

      try {
        const channel = await Channel.findOne({ where: { username: channelName } });
        if (!channel?.twitch_user_id) {
          return res.status(404).json({ error: "Channel not found" });
        }
        const scopeCheck = await checkRedemptionsScope(channel.id);
        if (scopeCheck === null) {
          // Twitch did not answer; that is not a missing scope.
          return res.status(503).json({ error: "Could not reach Twitch. Please try again." });
        }
        if (!scopeCheck) {
          return res.status(403).json({ reason: "no_scope", error: "Reauthorization required." });
        }

        const created = await createGiveaway({
          channel: channelName,
          type: "redeem",
          prize: prize || null,
          rewardCost: cost,
          targetWinnerCount: winnerCount,
          maxPerUserPerStream,
          maxPerStream,
          cooldownSeconds,
        });
        if (!created.ok) {
          return res.status(409).json({ error: "A giveaway is already active. Close it first." });
        }

        const reward = await createReward(channel.id, {
          title: prize || "Giveaway Entry",
          cost,
          prompt,
          backgroundColor,
          maxPerUserPerStream,
          maxPerStream,
          cooldownSeconds,
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

        await channelEvents.subscribeRedemption(channel, reward.rewardId);

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
          await channelEvents.unsubscribeRedemption(channel, giveaway.reward_id);
          // Remove the reward from the channel entirely when the giveaway ends.
          await deleteReward(channel.id, giveaway.reward_id);
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

    controlApp.post("/giveaway/redeem/reset", async (req: any, res: any) => {
      const channelName = String(req.body?.channel || "").trim().toLowerCase();
      if (!channelName) return res.status(400).json({ error: "channel is required" });

      try {
        const channel = await Channel.findOne({ where: { username: channelName } });
        const giveaway = await getActiveGiveaway(channelName);
        const accessToken = channel ? decryptChannelAccessToken(channel) : null;
        if (!channel?.twitch_user_id || !giveaway?.reward_id || !accessToken) {
          return res.status(409).json({ error: "Active channel-point giveaway not found" });
        }

        const rewardId = await replaceRewardForNextRound(
          {
            channelId: channel.id,
            broadcasterId: channel.twitch_user_id,
            accessToken,
            rewardId: giveaway.reward_id,
          },
          {
            snapshotReward: getRewardSnapshot,
            removeSubscription: (_broadcasterId, oldRewardId) => channelEvents.unsubscribeRedemption(channel, oldRewardId),
            deleteReward,
            createReward,
            updateReward,
            storeRewardId: async (nextRewardId) => {
              await giveaway.update({ reward_id: nextRewardId });
            },
            addSubscription: (_broadcasterId, _token, nextRewardId) => {
              void channelEvents.subscribeRedemption(channel, nextRewardId);
            },
            setRewardPaused,
            getRewardPausedState: async (channelId, nextRewardId) => {
              const reward = await getRewardDiagnostics(channelId, nextRewardId);
              return reward?.isPaused ?? null;
            },
            resetEntries: () => resetEntries(giveaway.id),
          },
        );

        logger.info(`[ControlAPI] Opened next giveaway round for ${channelName} (reward ${rewardId})`);
        return res.json({ success: true, rewardId });
      } catch (err) {
        logger.error("[ControlAPI] Failed to reset redeem giveaway:", err);
        return res.status(502).json({ error: "Could not open the next giveaway round" });
      }
    });
    // --- end Giveaways ---

    const controlServer: http.Server = controlApp.listen(4000, '127.0.0.1', () => {
      logger.info("Bot control API running on http://127.0.0.1:4000");
    });
    // Stop taking requests and drop idle keep-alive sockets.
    onShutdown('controlApi', () => new Promise<void>((resolve) => {
      controlServer.close(() => resolve());
      controlServer.closeAllConnections?.();
    }));
    onShutdown('conduitRuntime', async () => {
      await getConduitRuntime()?.stop();
    });
    // --- end Control API ---

    // Channels load after the Control API is listening so the dashboard can
    // reach /health, /add-channel, etc. while startup is still joining chats.
    await loadChatReadinessCache();
    // Start the shards first so conduit chat flows as channels reconcile.
    startConduitRuntime();
    await botManager.loadTokensOnStartup();
    // Start bot token auto refresher (checks every 5 minutes; refreshes when <=10 minutes left)
    startBotTokenAutoRefresher();
    // Refresh per-channel custom-bot account tokens before they expire.
    startCustomBotTokenRefresher();
    startCacheUpdater();

    logger.info("Bot is up and running!");
    startupComplete = true;

    // Stream sessions are persisted; the poller picks them back up on its own.
    const activeSessions = await StreamSession.findAll();
    logger.info(`[Startup] Tracking resumed for ${activeSessions.length} active stream session(s)`);

    // Restore redemption EventSub subscriptions for every non-closed redeem
    // giveaway so paused/drawn rewards remain connected across bot restarts.
    try {
      const allRedeemGiveaways = await Giveaway.findAll({
        where: { status: { [Op.ne]: "closed" }, type: "redeem" },
      });
      // Only enabled conduit channels were covered by the startup reconcile; disabled ones still restore per user.
      const conduitUsernames = getConduitRuntime()
        ? new Set(
            (await Channel.findAll({ where: { chat_transport: "eventsub", bot_enabled: true } }))
              .filter((c: any) => c.twitch_user_id && c.access_token)
              .map((c) => c.username),
          )
        : new Set<string>();
      const redeemGiveaways = allRedeemGiveaways.filter((giveaway) => !conduitUsernames.has(giveaway.channel));
      const restoredChannels = new Map<string, Channel>();
      const restoration = await restoreGiveawayRedemptionSubscriptions(
        redeemGiveaways.map((giveaway) => ({
          id: giveaway.id,
          channel: giveaway.channel,
          type: giveaway.type,
          status: giveaway.status,
          rewardId: giveaway.reward_id,
        })),
        {
          resolveChannel: async (username) => {
            const channel = await Channel.findOne({ where: { username } });
            const token = channel ? decryptChannelAccessToken(channel) : null;
            if (!channel?.twitch_user_id || !token) return null;
            restoredChannels.set(username, channel);
            return { broadcasterId: channel.twitch_user_id, accessToken: token };
          },
          subscribe: ({ giveawayId, channel, rewardId }) => {
            void channelEvents.subscribeRedemption(restoredChannels.get(channel)!, rewardId);
            logger.info(
              `[Startup] Restored redemption subscription for giveaway ${giveawayId} in ${channel} (reward ${rewardId})`,
            );
          },
          onError: (giveaway, error) => {
            logger.warn(
              `[Startup] Could not restore redemption subscription for giveaway ${giveaway.id} in ${giveaway.channel} (reward ${giveaway.rewardId || 'none'}): ${error instanceof Error ? error.message : String(error)}`,
            );
          },
        },
      );
      logger.info(
        `[Startup] Redemption subscription restore complete: ${restoration.restored} restored, ${restoration.failed} failed`,
      );
    } catch (err) {
      logger.error("[Startup] Failed to restore redeem giveaway subscriptions:", err);
    }

    const stopGiveawayReconciler = startGiveawayRedemptionReconciler();
    onShutdown('giveawayReconciler', stopGiveawayReconciler);

    const stopProcessMetrics = startProcessMetricsRecorder({
      getConnectedChannels: () => countConnectedChannels({
        ircClients: Object.values(clients),
        eventsubChannels: channelsOnTransport('eventsub'),
        conduitShardsAssigned: getConduitRuntime()?.shardsAssigned() ?? 0,
      }),
    });
    onShutdown('processMetrics', stopProcessMetrics);

    await balanceDbReady;
    const stopPatchNotesWatcher = startPatchNotesWatcher();
    onShutdown('patchNotesWatcher', stopPatchNotesWatcher);


  } catch (error) {
    logger.error("Failed to initialize bot services:", error);
    process.exit(1);
  }
}).catch((error) => {
  logger.error("Database initialization failed:", error);
  process.exit(1);
});
