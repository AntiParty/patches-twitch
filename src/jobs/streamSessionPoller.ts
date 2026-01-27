import { getLiveStreamsForUsers, refreshToken, getStreamStatusForUser } from '../util/twitchUtils';
import { getActiveSessions, Channel, StreamSession } from '../db';
import { sendDiscordAlert } from '../handlers/discordHandler';
import { getLatestLeaderboardData, getLatestWorldTourData } from '@/commands/record';
import logger from '../util/logger';
import { isUserAssignedToShard } from '../util/sharding';

const POLL_INTERVAL_MS = 60_000; // Poll every 60 seconds
const alertedMissingSession: Set<string> = new Set();

let lastTokenRefreshTime = 0;
const TOKEN_REFRESH_INTERVAL_MS = 30 * 60 * 1000; // Refresh app token every 30 minutes

export async function getTrackedUsernames(): Promise<string[]> {
  const channels = await Channel.findAll({ attributes: ['username'] });
  return channels
    .map((c: any) => c.username)
    .filter(username => isUserAssignedToShard(username));
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
      const trackedUsers = await getTrackedUsernames(); // Implement this to return usernames you want to track
      
      // Ensure app token is valid before making requests
      await ensureAppTokenValid();
      
      const liveStreams = await getLiveStreamsForUsers(trackedUsers); // Twitch API call
      const activeSessions = await getActiveSessions(); // DB query
      
      const liveUsernames = new Set(liveStreams.map(u => u.username));
      
      // Update LIVE users individually (to save their specific thumbnail URL)
      for (const liveUser of liveStreams) {
          await Channel.update(
              { 
                  is_live: true, 
                  stream_thumbnail_url: liveUser.thumbnailUrl || null 
              },
              { where: { username: liveUser.username } }
          );
      }
      
      // Update OFFLINE users (bulk is fine here)
      const offlineUsernames = trackedUsers.filter(u => !liveUsernames.has(u));
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

      for (const user of liveStreams) {
        const session = activeSessions.find(s => s.channel === user.username);
        let shouldCreateSession = !session;

        // Check if existing session is stale (from a previous stream)
        if (session && user.streamStartTime) {
          const streamStart = new Date(user.streamStartTime).getTime();
          const sessionStart = new Date(session.started_at).getTime();
          
          // If the stream started significantly AFTER the session (e.g. > 10 mins),
          // updates the session because the current session belongs to an older stream.
          if (streamStart > sessionStart + 10 * 60 * 1000) {
            shouldCreateSession = true;
            logger.info(`[SessionPoller] Detected stale session for ${user.username}. Stream: ${user.streamStartTime}, Session: ${session.started_at}. Marked for reset.`);
          }
        }

        if (shouldCreateSession) {
          // Only alert once per live session
          if (!alertedMissingSession.has(user.username)) {
            // Fetch channel info
            let channel = await Channel.findOne({ where: { username: user.username } });
            if (!channel?.player_id) {
              // Only alert if we haven't checked recently or if it's a new issue
               // Logic preserved from original
              await sendDiscordAlert({
                type: 'warning',
                title: 'Missing Stream Session',
                description: `User ${user.username} is live on Twitch, but no session has started in the bot and no linked THE FINALS account.`,
              });

              try {
                const { botManager } = await import('../botManager');
                await botManager.sendMessage(
                  `Hey @${user.username}, I see you're live! To track your leaderboard stats, please link your account using !link <EmbarkID>.`,
                  user.username
                );
              } catch (e) {
                logger.error(`Failed to send unlinked account alert to ${user.username}:`, e);
              }
              
              alertedMissingSession.add(user.username);
              continue;
            }
            const playerId = channel.player_id.toLowerCase();
            const cachedData = await getLatestLeaderboardData();
            const worldTourData = await getLatestWorldTourData();

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
            const wtPlayer = findPlayer(worldTourData, playerId);

            if (!player && !wtPlayer) {
              await sendDiscordAlert({
                type: 'warning',
                title: 'Missing Stream Session',
                description: `User ${user.username} is live on Twitch, but no session has started in the bot and not found in leaderboard caches.`,
              });
              alertedMissingSession.add(user.username);
              continue;
            }
            const startScore = player?.rankScore ?? 0;
            const startWTRank = wtPlayer?.rank ?? null;

            await StreamSession.upsert({
              channel: user.username.toLowerCase(),
              start_score: startScore,
              start_wt_rank: startWTRank,
              started_at: new Date()
            });
            await sendDiscordAlert({
              type: 'info',
              title: 'StreamSession Started Automatically',
              description: `User ${user.username} is live on Twitch and a new StreamSession was started automatically by polling.\nstart_score: ${startScore}, start_wt_rank: ${startWTRank ?? 'N/A'}`,
            });
            // Remove from alert set since session is now started
            alertedMissingSession.delete(user.username);
          }
        } else {
          // If session exists and is valid, remove from alert set
          alertedMissingSession.delete(user.username);
        }
      }
    } catch (err) {
      logger.error('Polling error:', err);
    }
  }, POLL_INTERVAL_MS);
};