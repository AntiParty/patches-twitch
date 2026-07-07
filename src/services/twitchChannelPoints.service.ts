/**
 * Channel Points reward helpers for the redeem giveaway.
 *
 * Creates/disables a custom channel-point reward on the broadcaster's channel
 * using their stored user token, refreshing once on 401. All calls require the
 * `channel:manage:redemptions` scope; callers that don't have it should surface
 * a re-auth prompt rather than proceed.
 */
import axios from 'axios';
import { Channel } from '@/db';
import { decryptChannelAccessToken, refreshAccessToken } from '@/util/twitchUtils';
import logger from '@/util/logger';

const MANAGE_SCOPE = 'channel:manage:redemptions';
const REWARDS_URL = 'https://api.twitch.tv/helix/channel_points/custom_rewards';

export type CreateRewardResult =
  | { ok: true; rewardId: string }
  | { ok: false; reason: 'no_scope' | 'no_token' | 'error'; message?: string };

async function loadChannel(channelId: number): Promise<any | null> {
  return Channel.findByPk(channelId);
}

async function validateScopes(accessToken: string): Promise<string[]> {
  const res = await axios.get('https://id.twitch.tv/oauth2/validate', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return Array.isArray(res.data?.scopes) ? res.data.scopes : [];
}

/** True if the broadcaster's stored token carries the redemptions management scope. */
export async function hasRedemptionsScope(channelId: number): Promise<boolean> {
  try {
    const channel = await loadChannel(channelId);
    if (!channel) return false;
    let token = decryptChannelAccessToken(channel);
    if (!token) return false;
    try {
      const scopes = await validateScopes(token);
      return scopes.includes(MANAGE_SCOPE);
    } catch (err: any) {
      if (err?.response?.status !== 401) throw err;
      const refreshed = await refreshAccessToken(channel);
      if (!refreshed) return false;
      const scopes = await validateScopes(refreshed);
      return scopes.includes(MANAGE_SCOPE);
    }
  } catch (err) {
    logger.error('[ChannelPoints] hasRedemptionsScope failed', err);
    return false;
  }
}

async function requestWithRefresh(
  channelId: number,
  run: (channel: any, token: string) => Promise<any>
): Promise<any> {
  let channel = await loadChannel(channelId);
  if (!channel?.twitch_user_id) throw new Error('no_channel');
  const token = decryptChannelAccessToken(channel);
  if (!token) throw new Error('no_token');
  try {
    return await run(channel, token);
  } catch (err: any) {
    if (err?.response?.status !== 401) throw err;
    const refreshed = await refreshAccessToken(channel);
    if (!refreshed) throw new Error('no_token');
    channel = await loadChannel(channelId);
    const newToken = decryptChannelAccessToken(channel) || refreshed;
    return run(channel, newToken);
  }
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export async function createReward(
  channelId: number,
  input: { title: string; cost: number; prompt?: string; backgroundColor?: string }
): Promise<CreateRewardResult> {
  if (!(await hasRedemptionsScope(channelId))) {
    return { ok: false, reason: 'no_scope' };
  }
  const prompt = input.prompt?.trim().slice(0, 200);
  const backgroundColor =
    input.backgroundColor && HEX_COLOR.test(input.backgroundColor)
      ? input.backgroundColor.toUpperCase()
      : undefined;
  try {
    const data = await requestWithRefresh(channelId, async (channel, token) => {
      const res = await axios.post(
        REWARDS_URL,
        {
          title: input.title,
          cost: Math.max(1, Math.floor(input.cost)),
          // Auto-fulfill entries so they don't pile up in the streamer's redemption queue.
          should_redemptions_skip_request_queue: true,
          ...(prompt ? { prompt, is_user_input_required: false } : {}),
          ...(backgroundColor ? { background_color: backgroundColor } : {}),
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Client-Id': process.env.TWITCH_CLIENT_ID!,
            'Content-Type': 'application/json',
          },
          params: { broadcaster_id: channel.twitch_user_id },
        }
      );
      return res.data;
    });
    const rewardId = data?.data?.[0]?.id;
    if (!rewardId) return { ok: false, reason: 'error', message: 'No reward id returned.' };
    return { ok: true, rewardId: String(rewardId) };
  } catch (err: any) {
    const message = err?.response?.data?.message || err?.message || 'error';
    logger.error('[ChannelPoints] createReward failed', message);
    if (String(message).toLowerCase().includes('no_token')) return { ok: false, reason: 'no_token' };
    return { ok: false, reason: 'error', message: String(message) };
  }
}

export async function setRewardEnabled(
  channelId: number,
  rewardId: string,
  enabled: boolean
): Promise<boolean> {
  return patchReward(channelId, rewardId, { is_enabled: enabled }, 'setRewardEnabled');
}

/** Toggle Twitch's native paused state so viewers temporarily can't redeem. */
export async function setRewardPaused(
  channelId: number,
  rewardId: string,
  paused: boolean
): Promise<boolean> {
  return patchReward(channelId, rewardId, { is_paused: paused }, 'setRewardPaused');
}

/** Delete the custom reward from the channel entirely (used when a giveaway ends). */
export async function deleteReward(channelId: number, rewardId: string): Promise<boolean> {
  try {
    await requestWithRefresh(channelId, async (channel, token) => {
      return axios.delete(REWARDS_URL, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Client-Id': process.env.TWITCH_CLIENT_ID!,
        },
        params: { broadcaster_id: channel.twitch_user_id, id: rewardId },
      });
    });
    return true;
  } catch (err: any) {
    logger.error('[ChannelPoints] deleteReward failed', err?.response?.data || err?.message);
    return false;
  }
}

async function patchReward(
  channelId: number,
  rewardId: string,
  body: Record<string, unknown>,
  label: string
): Promise<boolean> {
  try {
    await requestWithRefresh(channelId, async (channel, token) => {
      return axios.patch(REWARDS_URL, body, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Client-Id': process.env.TWITCH_CLIENT_ID!,
          'Content-Type': 'application/json',
        },
        params: { broadcaster_id: channel.twitch_user_id, id: rewardId },
      });
    });
    return true;
  } catch (err: any) {
    logger.error(`[ChannelPoints] ${label} failed`, err?.response?.data || err?.message);
    return false;
  }
}
