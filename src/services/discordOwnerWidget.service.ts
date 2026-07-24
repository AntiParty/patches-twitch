import axios from 'axios';
import { Channel, PeakRank, StreamSession } from '@/db';
import { getLatestLeaderboardData } from '@/commands/record';
import { searchPlayer } from '@/util/leaderboardSearch';
import { getRankIconUrl } from '@/util/rankIcons';
import logger from '@/util/logger';

const DISCORD_API_BASE = 'https://discord.com/api/v9';

export interface OwnerWidgetStats {
  playerName: string;
  currentRank: number;
  currentLeague: string;
  currentRS: number;
  sessionChange: number | null;
  peakLeague: string;
  peakRS: number;
  peakSeason: string;
  ownerLabel: string;
  rankIconUrl: string;
}

export interface OwnerWidgetConfig {
  applicationId: string;
  ownerUserId: string;
  botToken: string;
  channel: string;
  identityId: string;
}

interface PatchOptions {
  headers: Record<string, string>;
  timeout: number;
}

interface OwnerWidgetDependencies {
  loadStats: (channel: string, leaderboard?: any[]) => Promise<OwnerWidgetStats | null>;
  patch: (url: string, body: unknown, options: PatchOptions) => Promise<unknown>;
}

export type OwnerWidgetSyncResult =
  | { ok: true }
  | { ok: false; reason: 'stats_unavailable' | 'discord_error' };

function signedRS(value: number | null): string {
  if (value === null) return 'No active session';
  return `${value >= 0 ? '+' : ''}${value.toLocaleString('en-US')} RS`;
}

function displayPlayerName(value: string): string {
  const withoutTwitchPrefix = value.replace(/^twitch[-_\s]*/i, '');
  return withoutTwitchPrefix.split('#')[0].trim() || value;
}

function shortSeason(value: string): string {
  return value.replace(/^Season\s+/i, 'S');
}

export function buildOwnerWidgetPayload(stats: OwnerWidgetStats) {
  const displayName = displayPlayerName(stats.playerName);
  return {
    username: displayName,
    data: {
      dynamic: [
        { type: 1, name: 'player_name', value: displayName },
        { type: 3, name: 'rank_icon', value: { url: stats.rankIconUrl } },
        { type: 1, name: 'current_league', value: stats.currentLeague },
        { type: 1, name: 'current_rank', value: `#${stats.currentRank.toLocaleString('en-US')}` },
        { type: 1, name: 'current_rs', value: `${stats.currentRS.toLocaleString('en-US')} RS` },
        { type: 1, name: 'session_change', value: signedRS(stats.sessionChange) },
        { type: 1, name: 'peak_rank', value: `${stats.peakRS.toLocaleString('en-US')} RS` },
        {
          type: 1,
          name: 'peak_record',
          value: `${stats.peakLeague} · ${shortSeason(stats.peakSeason)}`,
        },
        { type: 1, name: 'owner_label', value: stats.ownerLabel },
      ],
    },
  };
}

function seasonLabel(value: string | null | undefined): string {
  const season = String(value || '').match(/(\d+)/)?.[1];
  return season ? `Season ${season}` : 'Current season';
}

export async function loadOwnerWidgetStats(
  channelName: string,
  providedLeaderboard?: any[],
): Promise<OwnerWidgetStats | null> {
  const channel = channelName.replace(/^#/, '').trim().toLowerCase();
  const account = await Channel.findOne({ where: { username: channel } }) as any;
  if (!account?.player_id) return null;

  const leaderboard = providedLeaderboard || await getLatestLeaderboardData();
  const player = searchPlayer(leaderboard, account.player_id);
  if (!player) return null;

  const currentRank = Math.max(1, Math.floor(Number(player.rank)));
  const currentRS = Math.max(0, Math.floor(Number(player.rankScore)));
  if (!Number.isFinite(currentRank) || !Number.isFinite(currentRS)) return null;

  const [peak, session] = await Promise.all([
    PeakRank.findOne({ where: { channel } }) as Promise<any | null>,
    StreamSession.findOne({ where: { channel } }) as Promise<any | null>,
  ]);

  const peakRS = peak?.regular_rs != null && Number.isFinite(Number(peak.regular_rs))
    ? Math.max(0, Math.floor(Number(peak.regular_rs)))
    : currentRS;

  return {
    playerName: String(player.name || account.player_id),
    currentRank,
    currentLeague: String(player.league || 'Unranked'),
    currentRS,
    sessionChange: Number.isFinite(Number(session?.start_score))
      ? currentRS - Math.floor(Number(session.start_score))
      : null,
    peakLeague: String(peak?.regular_league || player.league || 'Unranked'),
    peakRS,
    peakSeason: seasonLabel(peak?.regular_season),
    ownerLabel: 'Founder · FinalsRS.com',
    rankIconUrl: getRankIconUrl(player.league),
  };
}

export function createOwnerWidgetSync(
  config: OwnerWidgetConfig,
  dependencies: OwnerWidgetDependencies,
) {
  return async (leaderboard?: any[]): Promise<OwnerWidgetSyncResult> => {
    try {
      const stats = await dependencies.loadStats(config.channel, leaderboard);
      if (!stats) return { ok: false, reason: 'stats_unavailable' };

      const url = `${DISCORD_API_BASE}/applications/${encodeURIComponent(config.applicationId)}`
        + `/users/${encodeURIComponent(config.ownerUserId)}`
        + `/identities/${encodeURIComponent(config.identityId)}/profile`;

      await dependencies.patch(url, buildOwnerWidgetPayload(stats), {
        headers: {
          Authorization: `Bot ${config.botToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });
      return { ok: true };
    } catch (error: any) {
      logger.error(
        '[DiscordOwnerWidget] Profile update failed:',
        error?.response?.data?.message || error?.message || 'unknown error',
      );
      return { ok: false, reason: 'discord_error' };
    }
  };
}

export function readOwnerWidgetConfig(
  env: NodeJS.ProcessEnv = process.env,
): OwnerWidgetConfig | null {
  const applicationId = env.DISCORD_WIDGET_APPLICATION_ID?.trim();
  const ownerUserId = env.DISCORD_WIDGET_OWNER_USER_ID?.trim();
  const botToken = env.DISCORD_WIDGET_BOT_TOKEN?.trim();
  if (!applicationId || !ownerUserId || !botToken) return null;

  return {
    applicationId,
    ownerUserId,
    botToken,
    channel: (env.DISCORD_WIDGET_CHANNEL || 'antiparty').replace(/^#/, '').trim().toLowerCase(),
    identityId: (env.DISCORD_WIDGET_IDENTITY_ID || '0').trim(),
  };
}

let syncInFlight: Promise<OwnerWidgetSyncResult> | null = null;

export async function syncConfiguredOwnerWidget(
  leaderboard?: any[],
): Promise<OwnerWidgetSyncResult | { ok: false; reason: 'not_configured' | 'already_syncing' }> {
  const config = readOwnerWidgetConfig();
  if (!config) return { ok: false, reason: 'not_configured' };
  if (syncInFlight) return { ok: false, reason: 'already_syncing' };

  const sync = createOwnerWidgetSync(config, {
    loadStats: loadOwnerWidgetStats,
    patch: (url, body, options) => axios.patch(url, body, options),
  });
  syncInFlight = sync(leaderboard);
  try {
    return await syncInFlight;
  } finally {
    syncInFlight = null;
  }
}
