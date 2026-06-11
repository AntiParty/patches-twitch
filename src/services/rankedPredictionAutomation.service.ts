import {
  Channel,
  PredictionAutomationConfig,
  PredictionAutomationRun,
} from '@/db';
import {
  AutoPredictionRunStatus,
  DEFAULT_PREDICTION_AUTOMATION_CONFIG,
  PredictionAutomationConfigData,
  RankedPredictionOutcomeConfig,
  findMatchingOutcome,
  validatePredictionAutomationInput,
} from '@/models/predictionAutomation';
import { getCurrentRankedScore } from './rankedScore.service';
import { twitchPredictionsService } from './twitchPredictions.service';
import { predictionPresetService } from './predictionPreset.service';

export interface LiveStreamIdentity {
  id: string;
  username: string;
  gameName: string;
  startedAt: string;
}

export class PredictionAutomationPrerequisiteError extends Error {}

interface ChannelRecord {
  id: number;
  username: string;
  player_id: string | null;
  session_start_rs: number | null;
}

interface RunRecord {
  id: number;
  broadcaster_id: number;
  twitch_stream_id: string;
  status: AutoPredictionRunStatus;
  twitch_prediction_id?: string | null;
  twitch_outcome_ids_json?: string | null;
  prediction_created_at?: Date | null;
  resolved_at?: Date | null;
  failure_reason?: string | null;
}

interface StoredOutcome extends RankedPredictionOutcomeConfig {
  id: string;
}

interface AutomationDependencies {
  now: () => number;
  loadChannel: (channelId: number) => Promise<ChannelRecord | null>;
  loadConfig: (channelId: number) => Promise<PredictionAutomationConfigData>;
  saveConfig: (
    channelId: number,
    config: PredictionAutomationConfigData,
  ) => Promise<PredictionAutomationConfigData>;
  findRun: (channelId: number, streamId: string) => Promise<RunRecord | null>;
  findCurrentRun: (channelId: number) => Promise<RunRecord | null>;
  createRun: (values: Record<string, unknown>) => Promise<RunRecord>;
  updateRun: (
    run: RunRecord,
    values: Record<string, unknown>,
  ) => Promise<RunRecord>;
  getCurrentScore: (playerId: string) => Promise<number | null>;
  validateContent: (
    channel: ChannelRecord,
    config: PredictionAutomationConfigData,
  ) => Promise<void>;
  predictions: Pick<
    typeof twitchPredictionsService,
    'getAuthorizationStatus' | 'getCurrent' | 'getById' | 'start' | 'resolveById' | 'cancelById'
  >;
}

function parseOutcomes(value: string | null | undefined): StoredOutcome[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function serializeConfig(row: any): PredictionAutomationConfigData {
  if (!row) return {
    ...DEFAULT_PREDICTION_AUTOMATION_CONFIG,
    outcomes: DEFAULT_PREDICTION_AUTOMATION_CONFIG.outcomes.map((outcome) => ({ ...outcome })),
  };
  return validatePredictionAutomationInput({
    enabled: Boolean(row.enabled),
    startDelaySeconds: Number(row.start_delay_seconds),
    votingWindowSeconds: Number(row.voting_window_seconds),
    question: String(row.question),
    outcomes: JSON.parse(String(row.outcomes_json)),
  });
}

function productionDependencies(): AutomationDependencies {
  return {
    now: Date.now,
    loadChannel: async (channelId) => Channel.findByPk(channelId) as any,
    loadConfig: async (channelId) => serializeConfig(
      await PredictionAutomationConfig.findOne({ where: { broadcaster_id: channelId } }),
    ),
    saveConfig: async (channelId, config) => {
      const valid = validatePredictionAutomationInput(config);
      await PredictionAutomationConfig.upsert({
        broadcaster_id: channelId,
        enabled: valid.enabled,
        start_delay_seconds: valid.startDelaySeconds,
        voting_window_seconds: valid.votingWindowSeconds,
        question: valid.question,
        outcomes_json: JSON.stringify(valid.outcomes),
        created_at: new Date(),
        updated_at: new Date(),
      });
      return valid;
    },
    findRun: async (channelId, streamId) => PredictionAutomationRun.findOne({
      where: { broadcaster_id: channelId, twitch_stream_id: streamId },
    }) as any,
    findCurrentRun: async (channelId) => PredictionAutomationRun.findOne({
      where: { broadcaster_id: channelId },
      order: [['created_at', 'DESC']],
    }) as any,
    createRun: async (values) => PredictionAutomationRun.create(values) as any,
    updateRun: async (run, values) => {
      const model = run as any;
      if (typeof model.update === 'function') return model.update({
        ...values,
        updated_at: new Date(),
      });
      Object.assign(model, values);
      return model;
    },
    getCurrentScore: getCurrentRankedScore,
    validateContent: async (channel, config) => predictionPresetService.validateForTwitch({
      alias: 'automatic-ranked',
      title: config.question,
      outcomes: config.outcomes.map((outcome) => outcome.label),
      durationSeconds: config.votingWindowSeconds,
    }, { channel: channel.username }),
    predictions: twitchPredictionsService,
  };
}

export function createRankedPredictionAutomationService(
  overrides: Partial<AutomationDependencies> = {},
) {
  const deps = { ...productionDependencies(), ...overrides };

  async function setStatus(
    run: RunRecord,
    status: AutoPredictionRunStatus,
    values: Record<string, unknown> = {},
  ): Promise<RunRecord> {
    return deps.updateRun(run, { status, ...values });
  }

  async function ensureRun(channelId: number, streamId: string): Promise<RunRecord> {
    const existing = await deps.findRun(channelId, streamId);
    if (existing) return existing;
    try {
      return await deps.createRun({
        broadcaster_id: channelId,
        twitch_stream_id: streamId,
        status: 'scheduled',
        created_at: new Date(deps.now()),
        updated_at: new Date(deps.now()),
      });
    } catch (error) {
      const duplicate = await deps.findRun(channelId, streamId);
      if (duplicate) return duplicate;
      throw error;
    }
  }

  async function evaluateStream(
    channelId: number,
    stream: LiveStreamIdentity,
    options: { bypassDelay?: boolean } = {},
  ): Promise<RunRecord> {
    const config = await deps.loadConfig(channelId);
    if (!config.enabled) {
      return {
        id: 0,
        broadcaster_id: channelId,
        twitch_stream_id: stream.id,
        status: 'skipped',
        failure_reason: 'automation_disabled',
      };
    }
    const run = await ensureRun(channelId, stream.id);
    if (run.status === 'voting' && run.prediction_created_at) {
      const votingEndsAt = new Date(run.prediction_created_at).getTime()
        + config.votingWindowSeconds * 1000;
      if (deps.now() >= votingEndsAt) return setStatus(run, 'tracking');
    }
    if (['voting', 'tracking', 'resolving', 'resolved', 'canceled'].includes(run.status)) {
      return run;
    }
    if (stream.gameName.trim().toLowerCase() !== 'the finals') {
      return setStatus(run, 'waiting_for_category');
    }

    const channel = await deps.loadChannel(channelId);
    if (!channel?.player_id) {
      return setStatus(run, 'needs_attention', { failure_reason: 'linked_player_required' });
    }
    if (!Number.isFinite(channel.session_start_rs)) {
      return setStatus(run, 'waiting_for_start_rs', { failure_reason: 'starting_rs_unavailable' });
    }

    const startTime = Date.parse(stream.startedAt);
    if (
      !options.bypassDelay
      && Number.isFinite(startTime)
      && deps.now() < startTime + config.startDelaySeconds * 1000
    ) {
      return setStatus(run, 'scheduled', { failure_reason: null });
    }

    const current = await deps.predictions.getCurrent(channelId);
    if (current && current.id !== run.twitch_prediction_id) {
      if (run.status === 'creating') {
        return setStatus(run, 'needs_attention', {
          failure_reason: 'prediction_creation_uncertain',
        });
      }
      return setStatus(run, 'scheduled', { failure_reason: 'prediction_slot_busy' });
    }

    await setStatus(run, 'creating', { failure_reason: null });
    const created = await deps.predictions.start(channelId, {
      id: 0,
      channelId,
      alias: 'automatic-ranked',
      title: config.question,
      outcomes: config.outcomes.map((outcome) => outcome.label),
      durationSeconds: config.votingWindowSeconds,
    });
    const storedOutcomes: StoredOutcome[] = config.outcomes.map((outcome, index) => ({
      ...outcome,
      id: created.outcomes[index]?.id || '',
    }));
    return setStatus(run, 'voting', {
      twitch_prediction_id: created.id,
      twitch_outcome_ids_json: JSON.stringify(storedOutcomes),
      prediction_created_at: new Date(deps.now()),
      failure_reason: null,
    });
  }

  async function cancelRun(run: RunRecord, reason: string): Promise<RunRecord> {
    if (run.twitch_prediction_id) {
      await deps.predictions.cancelById(run.broadcaster_id, run.twitch_prediction_id);
    }
    return setStatus(run, 'canceled', {
      failure_reason: reason,
      resolved_at: new Date(deps.now()),
    });
  }

  async function finalizeStream(
    channelId: number,
    streamId: string,
  ): Promise<RunRecord | null> {
    const run = await deps.findRun(channelId, streamId);
    if (!run) return null;
    if (['resolved', 'canceled', 'skipped'].includes(run.status)) return run;
    if (!run.twitch_prediction_id) {
      return setStatus(run, 'skipped', { failure_reason: 'prediction_not_created' });
    }

    const exact = await deps.predictions.getById(channelId, run.twitch_prediction_id);
    if (exact?.status === 'RESOLVED') {
      return setStatus(run, 'resolved', { resolved_at: new Date(deps.now()) });
    }
    if (exact?.status === 'CANCELED') {
      return setStatus(run, 'canceled', { resolved_at: new Date(deps.now()) });
    }

    const channel = await deps.loadChannel(channelId);
    if (!channel?.player_id || !Number.isFinite(channel.session_start_rs)) {
      return cancelRun(run, 'ranked_score_unavailable');
    }
    const finalScore = await deps.getCurrentScore(channel.player_id);
    if (!Number.isFinite(finalScore)) {
      return cancelRun(run, 'ranked_score_unavailable');
    }

    const delta = Number(finalScore) - Number(channel.session_start_rs);
    const outcomes = parseOutcomes(run.twitch_outcome_ids_json);
    const matching = findMatchingOutcome(outcomes, delta) as StoredOutcome | null;
    if (!matching?.id) return cancelRun(run, 'outcome_match_invalid');

    await setStatus(run, 'resolving', { failure_reason: null });
    await deps.predictions.resolveById(
      channelId,
      run.twitch_prediction_id,
      matching.id,
    );
    return setStatus(run, 'resolved', {
      resolved_at: new Date(deps.now()),
      failure_reason: null,
    });
  }

  return {
    getConfig: deps.loadConfig,
    saveConfig: async (channelId: number, input: PredictionAutomationConfigData) => {
      const valid = validatePredictionAutomationInput(input);
      const channel = await deps.loadChannel(channelId);
      if (!channel) {
        throw new PredictionAutomationPrerequisiteError('Channel not found.');
      }
      await deps.validateContent(channel, valid);
      if (valid.enabled) {
        if (!channel.player_id) {
          throw new PredictionAutomationPrerequisiteError(
            'Link a THE FINALS ranked player before enabling automation.',
          );
        }
        const authorization = await deps.predictions.getAuthorizationStatus(channelId);
        if (authorization.state !== 'ready') {
          throw new PredictionAutomationPrerequisiteError(
            'Reauthorize Twitch predictions before enabling automation.',
          );
        }
      }
      return deps.saveConfig(channelId, valid);
    },
    getCurrentRun: deps.findCurrentRun,
    getStatus: async (channelId: number, stream?: LiveStreamIdentity | null) => {
      const config = await deps.loadConfig(channelId);
      const channel = await deps.loadChannel(channelId);
      let run = await deps.findCurrentRun(channelId);
      if (run?.status === 'voting' && run.prediction_created_at) {
        const votingEndsAt = new Date(run.prediction_created_at).getTime()
          + config.votingWindowSeconds * 1000;
        if (deps.now() >= votingEndsAt) run = await setStatus(run, 'tracking');
      }
      const latestRs = channel?.player_id
        ? await deps.getCurrentScore(channel.player_id)
        : null;
      const startingRs = Number.isFinite(channel?.session_start_rs)
        ? Number(channel?.session_start_rs)
        : null;
      const delta = startingRs !== null && Number.isFinite(latestRs)
        ? Number(latestRs) - startingRs
        : null;
      const streamStartedAt = stream ? Date.parse(stream.startedAt) : Number.NaN;
      const secondsUntilStart = stream && Number.isFinite(streamStartedAt)
        ? Math.max(
          0,
          Math.ceil(
            (streamStartedAt + config.startDelaySeconds * 1000 - deps.now()) / 1000,
          ),
        )
        : null;
      return {
        config,
        run,
        isLive: Boolean(stream),
        category: stream?.gameName || null,
        startingRs,
        latestRs: Number.isFinite(latestRs) ? Number(latestRs) : null,
        delta,
        secondsUntilStart,
      };
    },
    evaluateStream,
    finalizeStream,
    finalizeCurrent: async (channelId: number) => {
      const run = await deps.findCurrentRun(channelId);
      return run ? finalizeStream(channelId, run.twitch_stream_id) : null;
    },
    cancelCurrent: async (channelId: number) => {
      const run = await deps.findCurrentRun(channelId);
      return run && !['resolved', 'canceled', 'skipped'].includes(run.status)
        ? cancelRun(run, 'manual_cancel')
        : null;
    },
  };
}

export const rankedPredictionAutomationService = createRankedPredictionAutomationService();
