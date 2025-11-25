import { getLiveStreamsForUsers } from '../util/twitchUtils';
import { getActiveSessions, Channel, StreamSession } from '../db';
import { sendDiscordAlert } from '../handlers/discordHandler';
import { getLatestLeaderboardData, getLatestWorldTourData } from '@/commands/record';

const POLL_INTERVAL_MS = 60_000; // Poll every 60 seconds
const alertedMissingSession: Set<string> = new Set();
export async function getTrackedUsernames(): Promise<string[]> {
  const channels = await Channel.findAll({ attributes: ['username'] });
  return channels.map((c: any) => c.username);
}

export const startStreamSessionPolling = async () => {
  setInterval(async () => {
    try {
      const trackedUsers = await getTrackedUsernames(); // Implement this to return usernames you want to track
      const liveStreams = await getLiveStreamsForUsers(trackedUsers); // Twitch API call
      const activeSessions = await getActiveSessions(); // DB query

      for (const user of liveStreams) {
        const hasSession = activeSessions.some(s => s.channel === user.username);
        if (!hasSession) {
          // Only alert once per live session
          if (!alertedMissingSession.has(user.username)) {
            // Fetch channel info
            let channel = await Channel.findOne({ where: { username: user.username } });
            if (!channel?.player_id) {
              await sendDiscordAlert({
                type: 'warning',
                title: 'Missing Stream Session',
                description: `User ${user.username} is live on Twitch, but no session has started in the bot and no linked THE FINALS account.`,
              });
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
          // If session exists, remove from alert set so future alerts can happen after next offline/online
          alertedMissingSession.delete(user.username);
        }
      }
    } catch (err) {
      logger.error('Polling error:', err);
    }
  }, POLL_INTERVAL_MS);
};