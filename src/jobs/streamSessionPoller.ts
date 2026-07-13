import { getLiveStreamsForUsers, refreshToken } from '../util/twitchUtils';
import { getActiveSessions, Channel, StreamSession, PredictionAutomationRun } from '../db';
import { sendDiscordAlert } from '../handlers/discordHandler';
import { getLatestLeaderboardData } from '@/commands/record';
import logger from '../util/logger';
import { rankedPredictionAutomationService } from '@/services/rankedPredictionAutomation.service';

const POLL_INTERVAL_MS = 60_000; // Poll every 60 seconds
const alertedMissingSession: Map<string, number> = new Map(); // username -> timestamp of alert
const ALERT_EXPIRY_MS = 6 * 60 * 60 * 1000; // Clear stale alerts after 6 hours
const liveDetectedTime: Map<string, number> = new Map(); // username -> first-detected-live timestamp
const LEADERBOARD_GRACE_PERIOD_MS = 5 * 60 * 1000; // 5 minutes before firing leaderboard-miss alert

let lastTokenRefreshTime = 0;
const TOKEN_REFRESH_INTERVAL_MS = 30 * 60 * 1000; // Refresh app token every 30 minutes

// --- Reentrancy guard + watchdog state ---
// The poll cycle does a lot of sequential, network-bound work. If a cycle runs
// long (many live channels, slow Twitch API), overlapping setInterval ticks would
// double-process channels and race the prediction state machine. We guard against
// that and surface a hung cycle instead of silently skipping forever.
let pollInFlightSince = 0;
let hungAlerted = false;
let lastPollSuccessAt = Date.now();
const MAX_CYCLE_MS = 5 * 60 * 1000; // a cycle running longer than this is treated as hung

// --- Stuck auto-prediction run detection ---
const STUCK_TRANSIENT_MS = 3 * 60 * 1000; // 'creating'/'resolving' should clear within minutes
const STUCK_ATTENTION_MS = 15 * 60 * 1000; // 'needs_attention' lingering this long is worth a ping
const STUCK_ALERT_COOLDOWN_MS = 30 * 60 * 1000; // don't re-alert the same run more than this often
const stuckAlerted: Map<number, number> = new Map(); // runId -> last alert timestamp

export async function getTrackedUsernames(): Promise<string[]> {
  const channels = await Channel.findAll({ attributes: ['username'] });
  return channels.map((c: any) => c.username);
}

/** In-chat notice shown to a live streamer whose linked Embark ID isn't on the leaderboard. */
export function buildIgnNotFoundNotice(ign: string): string {
  return `I couldn't find ${ign} on the ranked leaderboard yet — if that's not your exact Embark ID, update it at finalsrs.com/dashboard.`;
}

async function ensureAppTokenValid(): Promise<string> {
  const now = Date.now();
  // Refresh token proactively every 30 minutes
  if (now - lastTokenRefreshTime > TOKEN_REFRESH_INTERVAL_MS) {
    try {
      await refreshToken();
      lastTokenRefreshTime = now;
      logger.info('App access token refreshed in stream polling');
    } catch (err) {
      logger.error('Failed to refresh app access token:', err);
    }
  }
  const token = process.env.TWITCH_APP_ACCESS_TOKEN || process.env.TWITCH_BOT_TOKEN;
  if (!token) {
    throw new Error('No valid Twitch token available for stream polling');
  }
  return token;
}

/**
 * Surface auto-prediction runs that are wedged in a transient state. A run sitting
 * in 'creating'/'resolving' for minutes, or 'needs_attention' for a long stretch,
 * means the engine stalled mid-cycle (the classic "it just died" symptom). We alert
 * once per run, throttled, so it's visible without spamming.
 */
export async function detectStuckRuns(now: number = Date.now()): Promise<void> {
  const { Op } = require('sequelize');
  const transientCutoff = new Date(now - STUCK_TRANSIENT_MS);
  const attentionCutoff = new Date(now - STUCK_ATTENTION_MS);

  const stuck = await PredictionAutomationRun.findAll({
    where: {
      [Op.or]: [
        {
          status: { [Op.in]: ['creating', 'resolving'] },
          updated_at: { [Op.lt]: transientCutoff },
        },
        {
          status: 'needs_attention',
          updated_at: { [Op.lt]: attentionCutoff },
        },
      ],
    },
  });

  for (const run of stuck as any[]) {
    const last = stuckAlerted.get(run.id) ?? 0;
    if (now - last < STUCK_ALERT_COOLDOWN_MS) continue;
    stuckAlerted.set(run.id, now);
    try {
      await sendDiscordAlert({
        type: 'error',
        title: 'Auto-prediction run stuck',
        description: `Run ${run.id} (channel id ${run.broadcaster_id}) has been "${run.status}" since ${new Date(run.updated_at).toLocaleString()}.`,
        fields: [
          { name: 'Status', value: String(run.status) },
          { name: 'Prediction ID', value: String(run.twitch_prediction_id || '—') },
          { name: 'Failure reason', value: String(run.failure_reason || '—') },
        ],
      });
    } catch (err) {
      logger.error('[Poller] Failed to send stuck-run alert:', err);
    }
  }

  // Prune cooldown entries that are well past the window so the map doesn't grow.
  for (const [id, ts] of stuckAlerted) {
    if (now - ts > STUCK_ALERT_COOLDOWN_MS * 2) stuckAlerted.delete(id);
  }
}

/**
 * One full poll cycle. Each stage is isolated so a transient failure in one channel
 * (or one stage) never aborts finalization/evaluation for the others. Only a failure
 * to obtain live-stream data — without which nothing can proceed — bubbles up to the
 * caller to abort the cycle.
 */
export async function runPollCycle(): Promise<void> {
  const trackedUsers = await getTrackedUsernames();

  // Ensure app token is valid before making requests
  await ensureAppTokenValid();

  const liveStreams = await getLiveStreamsForUsers(trackedUsers); // Batched Twitch API call
  const activeSessions = await getActiveSessions(); // DB query

  // Normalize all live usernames to lowercase for consistent comparison
  const liveUsernamesLower = new Set(liveStreams.map(u => u.username.toLowerCase()));
  const now = Date.now();

  // Track first time each user is detected as live this session
  for (const liveUser of liveStreams) {
    const uLower = liveUser.username.toLowerCase();
    if (!liveDetectedTime.has(uLower)) liveDetectedTime.set(uLower, now);
  }

  // Update LIVE users individually (to save their specific thumbnail URL)
  for (const liveUser of liveStreams) {
    try {
      await Channel.update(
        {
          is_live: true,
          stream_thumbnail_url: liveUser.thumbnailUrl || null,
        },
        {
          where: sequelizeCaseInsensitiveWhere('username', liveUser.username),
        },
      );
    } catch (error) {
      logger.error(`[Poller] Failed to mark ${liveUser.username} live:`, error);
    }
  }

  // Update OFFLINE users (bulk)
  const offlineUsernames = trackedUsers.filter(u => !liveUsernamesLower.has(u.toLowerCase()));
  if (offlineUsernames.length > 0) {
    try {
      const { Op } = require('sequelize');
      await Channel.update(
        {
          is_live: false,
          stream_thumbnail_url: null,
        },
        {
          where: {
            username: { [Op.in]: offlineUsernames },
          },
        },
      );
    } catch (error) {
      logger.error('[Poller] Failed to bulk-update offline users:', error);
    }
  }

  // --- Prune stale alert entries ---
  // Remove alerts for users who went offline (so they can be re-alerted next time)
  // and remove any entries older than 6 hours regardless
  for (const [alertUser, alertTime] of alertedMissingSession) {
    if (!liveUsernamesLower.has(alertUser) || (now - alertTime > ALERT_EXPIRY_MS)) {
      alertedMissingSession.delete(alertUser);
    }
  }

  // Clean up liveDetectedTime for users who are now offline
  for (const [u] of liveDetectedTime) {
    if (!liveUsernamesLower.has(u)) liveDetectedTime.delete(u);
  }

  // --- Clean up stale sessions for users who are offline ---
  // If EventSub missed the stream.offline event, the poller catches it here
  for (const session of activeSessions) {
    const sessionChannel = (session.channel || '').toLowerCase();
    if (!liveUsernamesLower.has(sessionChannel)) {
      // This user has an active session but is not live according to Twitch API
      // Grace period: only clean up if session is older than 5 minutes
      // (avoids race condition where stream just ended and EventSub is about to fire)
      const sessionAge = now - new Date(session.started_at).getTime();
      if (sessionAge > 5 * 60 * 1000) {
        try {
          const channel = await Channel.findOne({
            where: sequelizeCaseInsensitiveWhere('username', session.channel),
          });
          if (channel) {
            await rankedPredictionAutomationService.finalizeCurrent(channel.id);
            await channel.update({ session_start_rs: null });
          }
          await StreamSession.destroy({ where: { channel: session.channel } });
          logger.info(`[Poller] Cleaned up stale session for ${session.channel} (offline but session existed)`);
        } catch (error) {
          logger.error(`[AutoPrediction] Finalization failed for ${session.channel}:`, error);
        }
      }
    }
  }

  // --- Create sessions for live users who don't have one ---
  for (const user of liveStreams) {
    try {
      const userLower = user.username.toLowerCase();
      // Case-insensitive comparison
      const hasSession = activeSessions.some(s => (s.channel || '').toLowerCase() === userLower);
      if (!hasSession) {
        let channel = await Channel.findOne({
          where: sequelizeCaseInsensitiveWhere('username', user.username)
        });

        // --- 1. No linked account ---
        if (!channel?.player_id) {
          if (!alertedMissingSession.has(userLower)) {
            await sendDiscordAlert({
              type: 'warning',
              title: 'Missing Stream Session',
              description: `User ${user.username} is live on Twitch, but no session has started in the bot and no linked THE FINALS account.`,
            });
            const notifyEnabled = channel?.get('notify_chat_reminders') !== false;
            if (notifyEnabled) {
              try {
                const { botManager } = await import('../botManager');
                await botManager.sendMessage(
                  `Hey @${user.username}, I see you're live! Link your THE FINALS account with !link <EmbarkID> to track your stats. Type !suppress to disable these reminders.`,
                  user.username
                );
              } catch (e) {
                logger.error(`Failed to send unlinked account alert to ${user.username}:`, e);
              }
            }
            alertedMissingSession.set(userLower, now);
          }
          continue;
        }

        // --- 2. Has player_id — always attempt session creation (not gated by alert state) ---
        const playerId = channel.player_id.toLowerCase();
        const cachedData = await getLatestLeaderboardData();

        const findPlayer = (data: any[] | null, name: string) => {
          if (!data) return null;
          let player = data.find(p => p.name.toLowerCase() === name);
          if (!player && name.includes("#")) {
            const baseName = name.split("#")[0];
            player = data.find(p => p.name.toLowerCase().startsWith(baseName));
          }
          return player;
        };

        const player = findPlayer(cachedData, playerId);

        if (!player) {
          const detectedAt = liveDetectedTime.get(userLower) ?? now;
          const withinGrace = (now - detectedAt) < LEADERBOARD_GRACE_PERIOD_MS;
          if (withinGrace) continue;

          // Alert once, then keep retrying silently on future polls
          if (!alertedMissingSession.has(userLower)) {
            await sendDiscordAlert({
              type: 'warning',
              title: 'Missing Stream Session',
              description: `User ${user.username} is live on Twitch, but no session has started in the bot and not found in the ranked leaderboard cache.`,
            });
            alertedMissingSession.set(userLower, now);

            // Also tell the streamer directly (not just Discord), cooldown-gated.
            const notifyEnabled = channel?.get('notify_chat_reminders') !== false;
            if (notifyEnabled) {
              try {
                const { notifyChannel } = await import('../util/botAlerts');
                await notifyChannel(
                  user.username,
                  'ign-not-found',
                  buildIgnNotFoundNotice(channel.player_id),
                  { cooldownMs: 30 * 60 * 1000, alsoDiscord: false },
                );
              } catch (e) {
                logger.error(`[Poller] Failed to send ign-not-found notice to ${user.username}:`, e);
              }
            }
          }
          continue; // retry every 60s — no 6-hour lock
        }

        // --- 3. Player found — create session ---
        if (!Number.isFinite(player.rankScore)) {
          logger.warn(`[Poller] Ranked score unavailable for ${user.username}; session not started.`);
          continue;
        }
        const startScore = Number(player.rankScore);
        await StreamSession.upsert({
          channel: userLower,
          start_score: startScore,
          start_wt_rank: null,
          started_at: new Date()
        });
        await channel.update({ session_start_rs: startScore });
        await sendDiscordAlert({
          type: 'info',
          title: 'StreamSession Started Automatically',
          description: `User ${user.username} is live and session started.\nstart_score: ${startScore}`,
        });
        alertedMissingSession.delete(userLower);
      } else {
        alertedMissingSession.delete(userLower);
      }
    } catch (error) {
      logger.error(`[Poller] Session-creation step failed for ${user.username}:`, error);
    }
  }

  for (const user of liveStreams) {
    const channel = await Channel.findOne({
      where: sequelizeCaseInsensitiveWhere('username', user.username),
    });
    if (!channel) continue;
    const existingSession = activeSessions.find(
      (session) => String(session.channel || '').toLowerCase() === user.username.toLowerCase(),
    );
    if (
      existingSession
      && !Number.isFinite(channel.session_start_rs)
      && Number.isFinite(existingSession.start_score)
    ) {
      await channel.update({ session_start_rs: Number(existingSession.start_score) });
    }
    try {
      await rankedPredictionAutomationService.evaluateStream(channel.id, {
        id: user.id,
        username: user.username,
        gameName: user.gameName,
        startedAt: user.startedAt,
      });
    } catch (error) {
      logger.error(`[AutoPrediction] Evaluation failed for ${user.username}:`, error);
    }
  }

  // --- Engine health: surface runs wedged in a transient state ---
  try {
    await detectStuckRuns(now);
  } catch (error) {
    logger.error('[Poller] Stuck-run detection failed:', error);
  }
}

/**
 * Wraps a single poll cycle with a reentrancy guard. If the previous cycle is still
 * running we skip this tick; if it has been running implausibly long we treat it as
 * hung and alert (once) so a stalled cycle is visible instead of silently halting the
 * automation.
 */
async function tick(): Promise<void> {
  const now = Date.now();
  if (pollInFlightSince) {
    const elapsed = now - pollInFlightSince;
    if (elapsed > MAX_CYCLE_MS && !hungAlerted) {
      hungAlerted = true;
      logger.error(
        `[Poller] Previous cycle still running after ${Math.round(elapsed / 1000)}s; skipping. Possible hang.`,
      );
      await sendDiscordAlert({
        type: 'error',
        title: 'Stream poller appears hung',
        description: `A poll cycle has been running for ${Math.round(elapsed / 1000)}s and new cycles are being skipped. Last successful cycle: ${new Date(lastPollSuccessAt).toLocaleString()}.`,
      }).catch(() => {});
    } else {
      logger.warn('[Poller] Previous cycle still in flight; skipping this tick.');
    }
    return;
  }

  pollInFlightSince = now;
  hungAlerted = false;
  const startedAt = now;
  try {
    await runPollCycle();
    lastPollSuccessAt = Date.now();
    logger.debug(`[Poller] Cycle completed in ${Date.now() - startedAt}ms`);
  } catch (err) {
    logger.error('Polling error:', err);
  } finally {
    pollInFlightSince = 0;
  }
}

export const startStreamSessionPolling = async () => {
  setInterval(() => {
    void tick();
  }, POLL_INTERVAL_MS);
};

/**
 * Helper: build a case-insensitive where clause for Sequelize
 * Works with both SQLite (LIKE is case-insensitive) and Postgres (ILIKE)
 */
function sequelizeCaseInsensitiveWhere(column: string, value: string) {
  const { fn, col, where: seqWhere } = require('sequelize');
  return seqWhere(fn('lower', col(column)), value.toLowerCase());
}
