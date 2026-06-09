import { getLiveStreamsForUsers, refreshToken } from '../util/twitchUtils';
import { getActiveSessions, Channel, StreamSession } from '../db';
import { sendDiscordAlert } from '../handlers/discordHandler';
import { getLatestLeaderboardData } from '@/commands/record';
import logger from '../util/logger';

const POLL_INTERVAL_MS = 60_000; // Poll every 60 seconds
const alertedMissingSession: Map<string, number> = new Map(); // username -> timestamp of alert
const ALERT_EXPIRY_MS = 6 * 60 * 60 * 1000; // Clear stale alerts after 6 hours
const liveDetectedTime: Map<string, number> = new Map(); // username -> first-detected-live timestamp
const LEADERBOARD_GRACE_PERIOD_MS = 5 * 60 * 1000; // 5 minutes before firing leaderboard-miss alert

let lastTokenRefreshTime = 0;
const TOKEN_REFRESH_INTERVAL_MS = 30 * 60 * 1000; // Refresh app token every 30 minutes

export async function getTrackedUsernames(): Promise<string[]> {
  const channels = await Channel.findAll({ attributes: ['username'] });
  return channels.map((c: any) => c.username);
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

export const startStreamSessionPolling = async () => {
  setInterval(async () => {
    try {
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
          // Try exact match first, then case-insensitive
          const { Op } = require('sequelize');
          await Channel.update(
              {
                  is_live: true,
                  stream_thumbnail_url: liveUser.thumbnailUrl || null
              },
              {
                  where: sequelizeCaseInsensitiveWhere('username', liveUser.username)
              }
          );
      }

      // Update OFFLINE users (bulk)
      const offlineUsernames = trackedUsers.filter(u => !liveUsernamesLower.has(u.toLowerCase()));
      if (offlineUsernames.length > 0) {
          const { Op } = require('sequelize');
          await Channel.update(
              {
                  is_live: false,
                  stream_thumbnail_url: null
              },
              {
                  where: {
                      username: { [Op.in]: offlineUsernames }
                  }
              }
          );
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
            await StreamSession.destroy({ where: { channel: session.channel } });
            logger.info(`[Poller] Cleaned up stale session for ${session.channel} (offline but session existed)`);
          }
        }
      }

      // --- Create sessions for live users who don't have one ---
      for (const user of liveStreams) {
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
            }
            continue; // retry every 60s — no 6-hour lock
          }

          // --- 3. Player found — create session ---
          const startScore = player.rankScore ?? 0;
          await StreamSession.upsert({
            channel: userLower,
            start_score: startScore,
            start_wt_rank: null,
            started_at: new Date()
          });
          await sendDiscordAlert({
            type: 'info',
            title: 'StreamSession Started Automatically',
            description: `User ${user.username} is live and session started.\nstart_score: ${startScore}`,
          });
          alertedMissingSession.delete(userLower);
        } else {
          alertedMissingSession.delete(userLower);
        }
      }
    } catch (err) {
      logger.error('Polling error:', err);
    }
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
