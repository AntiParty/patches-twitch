import axios from 'axios';
import { Channel } from '@/db';
import { PredictionPresetData, predictionPresetService } from './predictionPreset.service';

const REQUIRED_SCOPE = 'channel:manage:predictions';
const SCOPE_CACHE_TTL_MS = 5 * 60 * 1000;
const PREDICTION_REAUTH_URL = 'https://finalsrs.com/reauth';

export type TwitchPredictionStatus = 'ACTIVE' | 'LOCKED' | 'RESOLVED' | 'CANCELED';

export type PredictionAuthorizationStatus =
  | { state: 'ready' }
  | { state: 'reauth_required'; reauthUrl: '/reauth' }
  | { state: 'unavailable'; message: string }
  | { state: 'temporarily_unavailable' };

export interface TwitchPredictionOutcome {
  id: string;
  title: string;
  // Present on Twitch GET /predictions responses; used to detect whether anyone voted.
  users?: number;
  channel_points?: number;
}

export interface TwitchPrediction {
  id: string;
  title: string;
  status: TwitchPredictionStatus;
  outcomes: TwitchPredictionOutcome[];
}

/**
 * True if at least one outcome received a vote (a participating user or any channel points).
 * Used to cancel and re-open predictions that locked with no participation.
 */
export function predictionHasVotes(prediction: TwitchPrediction | null | undefined): boolean {
  if (!prediction || !Array.isArray(prediction.outcomes)) return false;
  return prediction.outcomes.some(
    (outcome) => Number(outcome?.users) > 0 || Number(outcome?.channel_points) > 0,
  );
}

interface ChannelLike {
  id: number;
  username: string;
  twitch_user_id: string | null;
}

interface RequestConfig {
  method: 'GET' | 'POST' | 'PATCH';
  url: string;
  headers: Record<string, string>;
  params?: Record<string, string | number>;
  data?: Record<string, unknown>;
}

interface TokenMetadata {
  user_id?: string;
  scopes?: string[];
}

interface TwitchPredictionsDependencies {
  request: (config: RequestConfig) => Promise<any>;
  validateToken: (accessToken: string) => Promise<TokenMetadata>;
  refreshAccessToken: (channel: any) => Promise<string | null>;
  loadChannel: (channelId: number) => Promise<any | null>;
  getAccessToken: (channel: any) => string | null;
  now: () => number;
  validatePresetContent: (preset: PredictionPresetData, channel: ChannelLike) => Promise<void>;
}

export class PredictionReauthRequiredError extends Error {
  constructor(public readonly reauthUrl: string) {
    super('The broadcaster must reauthorize Twitch predictions.');
  }
}

export class PredictionUnavailableError extends Error {}
export class PredictionActiveConflictError extends Error {}
export class PredictionNoActiveError extends Error {}
export class PredictionTemporaryError extends Error {}

export class PredictionInvalidOutcomeError extends Error {
  constructor(public readonly choices: string[]) {
    super('That outcome was not found.');
  }
}

function responseStatus(error: any): number | undefined {
  return error?.response?.status;
}

function responseMessage(error: any): string {
  return String(error?.response?.data?.message || error?.message || '').toLowerCase();
}

function mapTwitchError(error: any, reauthUrl: string): Error {
  const status = responseStatus(error);
  const message = responseMessage(error);

  if (status === 401 || message.includes('scope') || message.includes('oauth')) {
    return new PredictionReauthRequiredError(reauthUrl);
  }
  if (message.includes('partner') || message.includes('affiliate')) {
    return new PredictionUnavailableError(
      'Channel Points Predictions require Twitch Affiliate or Partner status.',
    );
  }
  if (message.includes('active prediction') || message.includes('prediction already')) {
    return new PredictionActiveConflictError('A prediction is already active.');
  }
  if (status === 429 || (status !== undefined && status >= 500)) {
    return new PredictionTemporaryError('Twitch predictions are temporarily unavailable.');
  }
  return new PredictionTemporaryError('Twitch rejected the prediction request.');
}

function extractPredictions(response: any): TwitchPrediction[] {
  const data = response?.data?.data;
  return Array.isArray(data) ? data : [];
}

function productionDependencies(): TwitchPredictionsDependencies {
  return {
    request: (config) => axios.request(config),
    validateToken: async (accessToken) => {
      const response = await axios.get('https://id.twitch.tv/oauth2/validate', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return response.data || {};
    },
    refreshAccessToken: (channel) => require('@/util/twitchUtils').refreshAccessToken(channel),
    loadChannel: (channelId) => Channel.findByPk(channelId),
    getAccessToken: (channel) => require('@/util/twitchUtils').decryptChannelAccessToken(channel),
    now: Date.now,
    validatePresetContent: (preset, channel) => predictionPresetService.validateForTwitch(
      preset,
      { channel: channel.username },
    ),
  };
}

export function createTwitchPredictionsService(
  dependencyOverrides: Partial<TwitchPredictionsDependencies> = {},
) {
  const deps = { ...productionDependencies(), ...dependencyOverrides };
  const scopeCache = new Map<number, { token: string; expiresAt: number }>();

  function reauthError(): PredictionReauthRequiredError {
    return new PredictionReauthRequiredError(PREDICTION_REAUTH_URL);
  }

  async function loadChannel(channelId: number): Promise<any> {
    const channel = await deps.loadChannel(channelId);
    if (!channel?.twitch_user_id) throw reauthError();
    return channel;
  }

  async function authorize(channel: any, accessToken: string): Promise<void> {
    const cached = scopeCache.get(Number(channel.id));
    if (
      cached &&
      cached.token === accessToken &&
      cached.expiresAt > deps.now()
    ) {
      return;
    }

    let metadata: TokenMetadata;
    try {
      metadata = await deps.validateToken(accessToken);
    } catch (error: unknown) {
      if (responseStatus(error) === 401) throw error;
      throw new PredictionTemporaryError('Twitch predictions are temporarily unavailable.');
    }
    const scopes = Array.isArray(metadata.scopes) ? metadata.scopes : [];
    if (
      !scopes.includes(REQUIRED_SCOPE) ||
      String(metadata.user_id || '') !== String(channel.twitch_user_id)
    ) {
      throw reauthError();
    }
    scopeCache.set(Number(channel.id), {
      token: accessToken,
      expiresAt: deps.now() + SCOPE_CACHE_TTL_MS,
    });
  }

  async function runAuthorized<T>(
    channelId: number,
    operation: (channel: any, accessToken: string) => Promise<T>,
  ): Promise<T> {
    let channel = await loadChannel(channelId);
    let accessToken = deps.getAccessToken(channel);
    if (!accessToken) throw reauthError();

    try {
      await authorize(channel, accessToken);
      return await operation(channel, accessToken);
    } catch (error: any) {
      if (error instanceof PredictionReauthRequiredError) throw error;
      if (responseStatus(error) !== 401) throw mapTwitchError(error, reauthError().reauthUrl);

      const refreshed = await deps.refreshAccessToken(channel);
      if (!refreshed) throw reauthError();
      scopeCache.delete(Number(channel.id));
      channel = await loadChannel(channelId);
      accessToken = deps.getAccessToken(channel) || refreshed;

      try {
        await authorize(channel, accessToken);
        return await operation(channel, accessToken);
      } catch (retryError: any) {
        if (retryError instanceof PredictionReauthRequiredError) throw retryError;
        throw mapTwitchError(retryError, reauthError().reauthUrl);
      }
    }
  }

  async function getCurrent(channelId: number): Promise<TwitchPrediction | null> {
    return runAuthorized(channelId, async (channel, accessToken) => {
      const response = await deps.request({
        method: 'GET',
        url: 'https://api.twitch.tv/helix/predictions',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Client-Id': process.env.TWITCH_CLIENT_ID || '',
        },
        params: {
          broadcaster_id: String(channel.twitch_user_id),
          first: 20,
        },
      });
      return extractPredictions(response).find(
        (item) => item.status === 'ACTIVE' || item.status === 'LOCKED',
      ) || null;
    });
  }

  async function getById(
    channelId: number,
    predictionId: string,
  ): Promise<TwitchPrediction | null> {
    return runAuthorized(channelId, async (channel, accessToken) => {
      const response = await deps.request({
        method: 'GET',
        url: 'https://api.twitch.tv/helix/predictions',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Client-Id': process.env.TWITCH_CLIENT_ID || '',
        },
        params: {
          broadcaster_id: String(channel.twitch_user_id),
          id: predictionId,
        },
      });
      return extractPredictions(response)[0] || null;
    });
  }

  async function patchById(
    channelId: number,
    predictionId: string,
    status: 'RESOLVED' | 'CANCELED',
    winningOutcomeId?: string,
  ): Promise<TwitchPrediction> {
    return runAuthorized(channelId, async (channel, accessToken) => {
      const data: Record<string, unknown> = {
        broadcaster_id: String(channel.twitch_user_id),
        id: predictionId,
        status,
      };
      if (status === 'RESOLVED') data.winning_outcome_id = winningOutcomeId;
      const response = await deps.request({
        method: 'PATCH',
        url: 'https://api.twitch.tv/helix/predictions',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Client-Id': process.env.TWITCH_CLIENT_ID || '',
          'Content-Type': 'application/json',
        },
        data,
      });
      const prediction = extractPredictions(response)[0];
      if (!prediction) throw new PredictionTemporaryError('Twitch returned no prediction.');
      return prediction;
    });
  }

  async function getAuthorizationStatus(
    channelId: number,
  ): Promise<PredictionAuthorizationStatus> {
    try {
      await getCurrent(channelId);
      return { state: 'ready' };
    } catch (error: unknown) {
      if (error instanceof PredictionReauthRequiredError) {
        return { state: 'reauth_required', reauthUrl: '/reauth' };
      }
      if (error instanceof PredictionUnavailableError) {
        return { state: 'unavailable', message: error.message };
      }
      return { state: 'temporarily_unavailable' };
    }
  }

  return {
    getCurrent,
    getById,
    getAuthorizationStatus,
    resolveById: (
      channelId: number,
      predictionId: string,
      winningOutcomeId: string,
    ) => patchById(channelId, predictionId, 'RESOLVED', winningOutcomeId),
    cancelById: (channelId: number, predictionId: string) => (
      patchById(channelId, predictionId, 'CANCELED')
    ),

    async start(channelId: number, preset: PredictionPresetData): Promise<TwitchPrediction> {
      const current = await getCurrent(channelId);
      if (current) throw new PredictionActiveConflictError('A prediction is already active.');

      return runAuthorized(channelId, async (channel, accessToken) => {
        await deps.validatePresetContent(preset, channel);
        const response = await deps.request({
          method: 'POST',
          url: 'https://api.twitch.tv/helix/predictions',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Client-Id': process.env.TWITCH_CLIENT_ID || '',
            'Content-Type': 'application/json',
          },
          data: {
            broadcaster_id: String(channel.twitch_user_id),
            title: preset.title,
            outcomes: preset.outcomes.map((title) => ({ title })),
            prediction_window: preset.durationSeconds,
          },
        });
        const created = extractPredictions(response)[0];
        if (!created) throw new PredictionTemporaryError('Twitch returned no prediction.');
        return created;
      });
    },

    async resolve(channelId: number, selection: string): Promise<TwitchPrediction> {
      const current = await getCurrent(channelId);
      if (!current) throw new PredictionNoActiveError('There is no active prediction.');
      const trimmed = selection.trim();
      const number = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
      const outcome = number !== null
        ? current.outcomes[number - 1]
        : current.outcomes.find((item) => item.title.toLowerCase() === trimmed.toLowerCase());
      if (!outcome) {
        throw new PredictionInvalidOutcomeError(
          current.outcomes.map((item, index) => `${index + 1}. ${item.title}`),
        );
      }

      return runAuthorized(channelId, async (channel, accessToken) => {
        const response = await deps.request({
          method: 'PATCH',
          url: 'https://api.twitch.tv/helix/predictions',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Client-Id': process.env.TWITCH_CLIENT_ID || '',
            'Content-Type': 'application/json',
          },
          data: {
            broadcaster_id: String(channel.twitch_user_id),
            id: current.id,
            status: 'RESOLVED',
            winning_outcome_id: outcome.id,
          },
        });
        const resolved = extractPredictions(response)[0];
        if (!resolved) throw new PredictionTemporaryError('Twitch returned no prediction.');
        return resolved;
      });
    },

    async cancel(channelId: number): Promise<TwitchPrediction> {
      const current = await getCurrent(channelId);
      if (!current) throw new PredictionNoActiveError('There is no active prediction.');

      return runAuthorized(channelId, async (channel, accessToken) => {
        const response = await deps.request({
          method: 'PATCH',
          url: 'https://api.twitch.tv/helix/predictions',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Client-Id': process.env.TWITCH_CLIENT_ID || '',
            'Content-Type': 'application/json',
          },
          data: {
            broadcaster_id: String(channel.twitch_user_id),
            id: current.id,
            status: 'CANCELED',
          },
        });
        const canceled = extractPredictions(response)[0];
        if (!canceled) throw new PredictionTemporaryError('Twitch returned no prediction.');
        return canceled;
      });
    },
  };
}

export const twitchPredictionsService = createTwitchPredictionsService();
