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
import { predictionHasVotes, twitchPredictionsService } from './twitchPredictions.service';
import { predictionPresetService } from './predictionPreset.service';
import { hasPredictionAutomationAccess } from './predictionAutomationAccess.service';
import logger from '@/util/logger';
import { botControlHeaders, botControlUrl } from '@/util/botControl';

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
  has_subscription?: boolean;
  role?: string | null;
}

interface RunRecord {
  id: number;
  broadcaster_id: number;
  twitch_stream_id: string;
  mode?: string;
  cycle_index?: number;
  status: AutoPredictionRunStatus;
  twitch_prediction_id?: string | null;
  twitch_outcome_ids_json?: string | null;
  prediction_created_at?: Date | null;
  baseline_rs?: number | null;
  resolution_deadline_at?: Date | null;
  cooldown_until?: Date | null;
  resolved_at?: Date | null;
  failure_reason?: string | null;
}

interface StoredOutcome extends RankedPredictionOutcomeConfig {
  id: string;
}

interface AutomationDependencies {
  now: () => number;
  random: () => number;
  countEmptyRetries: (channelId: number, streamId: string) => Promise<number>;
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
  claimRun: (run: RunRecord) => Promise<boolean>;
  getCurrentScore: (playerId: string) => Promise<number | null>;
  validateContent: (
    channel: ChannelRecord,
    config: PredictionAutomationConfigData,
  ) => Promise<void>;
  announce: (channel: string, message: string) => Promise<void>;
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
    mode: row.mode || 'stream_total',
    startDelaySeconds: Number(row.start_delay_seconds),
    votingWindowSeconds: Number(row.voting_window_seconds),
    question: String(row.question),
    outcomes: JSON.parse(String(row.outcomes_json)),
  });
}

function productionDependencies(): AutomationDependencies {
  return {
    now: Date.now,
    random: Math.random,
    countEmptyRetries: async (channelId, streamId) => PredictionAutomationRun.count({
      where: {
        broadcaster_id: channelId,
        twitch_stream_id: streamId,
        failure_reason: 'no_votes',
      },
    }),
    loadChannel: async (channelId) => Channel.findByPk(channelId) as any,
    loadConfig: async (channelId) => serializeConfig(
      await PredictionAutomationConfig.findOne({ where: { broadcaster_id: channelId } }),
    ),
    saveConfig: async (channelId, config) => {
      const valid = validatePredictionAutomationInput(config);
      await PredictionAutomationConfig.upsert({
        broadcaster_id: channelId,
        enabled: valid.enabled,
        mode: valid.mode,
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
      order: [['cycle_index', 'DESC']],
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
    claimRun: async (run) => {
      const [updated] = await PredictionAutomationRun.update(
        {
          status: 'creating',
          failure_reason: null,
          updated_at: new Date(),
        },
        {
          where: {
            id: run.id,
            status: run.status,
          },
        },
      );
      if (updated === 1) {
        Object.assign(run, { status: 'creating', failure_reason: null });
        return true;
      }
      return false;
    },
    getCurrentScore: getCurrentRankedScore,
    validateContent: async (channel, config) => predictionPresetService.validateForTwitch({
      alias: 'automatic-ranked',
      title: config.question,
      outcomes: config.outcomes.map((outcome) => outcome.label),
      durationSeconds: config.votingWindowSeconds,
    }, { channel: channel.username }),
    announce: async (channel, message) => {
      // Bound the Control API call so a hung bot process can't stall the poll cycle.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      try {
        const response = await fetch(`${botControlUrl}/send-message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...botControlHeaders() },
          body: JSON.stringify({ channel, message }),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Bot control API returned ${response.status}.`);
        }
      } finally {
        clearTimeout(timeout);
      }
    },
    predictions: twitchPredictionsService,
  };
}

export function createRankedPredictionAutomationService(
  overrides: Partial<AutomationDependencies> = {},
) {
  const deps = { ...productionDependencies(), ...overrides };
  const repeatCooldownMs = 2 * 60 * 1000;
  const scoreChangeTimeoutMs = 30 * 60 * 1000;
  const maxEmptyRetries = 3;
  const emptyRetryMinMs = 10 * 60 * 1000;
  const emptyRetrySpanMs = 5 * 60 * 1000; // cooldown lands in [10, 15) minutes

  function emptyRetryCooldownMs(): number {
    return emptyRetryMinMs + Math.floor(deps.random() * emptyRetrySpanMs);
  }

  // Called when a 'voting' prediction's window has elapsed. Locks in to 'tracking' when
  // anyone voted, but if the prediction locked with zero participation it cancels and
  // schedules a retry after a cooldown. Never cancels on uncertainty (Twitch still ACTIVE,
  // missing prediction, or a transient getById failure).
  async function maybeLockOrRetry(
    run: RunRecord,
    trackingValues: Record<string, unknown> = {},
  ): Promise<RunRecord> {
    if (!run.twitch_prediction_id) {
      return setStatus(run, 'tracking', trackingValues);
    }
    let prediction;
    try {
      prediction = await deps.predictions.getById(run.broadcaster_id, run.twitch_prediction_id);
    } catch {
      return run; // transient — leave as 'voting' and retry on the next poll
    }
    if (prediction?.status === 'ACTIVE') {
      return run; // Twitch hasn't locked it yet; wait for the lock before judging votes
    }
    if (prediction && !predictionHasVotes(prediction)) {
      await deps.predictions.cancelById(run.broadcaster_id, run.twitch_prediction_id);
      return setStatus(run, 'canceled', {
        failure_reason: 'no_votes',
        resolved_at: new Date(deps.now()),
        cooldown_until: new Date(deps.now() + emptyRetryCooldownMs()),
      });
    }
    return setStatus(run, 'tracking', trackingValues);
  }

  async function setStatus(
    run: RunRecord,
    status: AutoPredictionRunStatus,
    values: Record<string, unknown> = {},
  ): Promise<RunRecord> {
    return deps.updateRun(run, { status, ...values });
  }

  async function createCycle(
    channelId: number,
    streamId: string,
    mode: PredictionAutomationConfigData['mode'],
    cycleIndex: number,
  ): Promise<RunRecord> {
    return deps.createRun({
      broadcaster_id: channelId,
      twitch_stream_id: streamId,
      mode,
      cycle_index: cycleIndex,
      status: 'scheduled',
      created_at: new Date(deps.now()),
      updated_at: new Date(deps.now()),
    });
  }

  async function ensureRun(
    channelId: number,
    streamId: string,
    mode: PredictionAutomationConfigData['mode'],
  ): Promise<RunRecord> {
    const existing = await deps.findRun(channelId, streamId);
    if (existing) return existing;
    try {
      return await createCycle(channelId, streamId, mode, 1);
    } catch (error) {
      const duplicate = await deps.findRun(channelId, streamId);
      if (duplicate) return duplicate;
      throw error;
    }
  }

  async function cancelRun(run: RunRecord, reason: string): Promise<RunRecord> {
    if (run.twitch_prediction_id) {
      await deps.predictions.cancelById(run.broadcaster_id, run.twitch_prediction_id);
    }
    return setStatus(run, 'canceled', {
      failure_reason: reason,
      resolved_at: new Date(deps.now()),
      cooldown_until: new Date(deps.now() + repeatCooldownMs),
    });
  }

  async function settleNextResult(
    run: RunRecord,
    currentScore: number | null,
  ): Promise<RunRecord> {
    if (!Number.isFinite(currentScore) || !Number.isFinite(run.baseline_rs)) {
      const deadline = run.resolution_deadline_at
        ? new Date(run.resolution_deadline_at).getTime()
        : Number.POSITIVE_INFINITY;
      return deps.now() >= deadline
        ? cancelRun(run, 'score_change_timeout')
        : run;
    }

    const delta = Number(currentScore) - Number(run.baseline_rs);
    if (delta === 0) {
      const deadline = run.resolution_deadline_at
        ? new Date(run.resolution_deadline_at).getTime()
        : Number.POSITIVE_INFINITY;
      return deps.now() >= deadline
        ? cancelRun(run, 'score_change_timeout')
        : run;
    }

    const outcomes = parseOutcomes(run.twitch_outcome_ids_json);
    const matching = findMatchingOutcome(outcomes, delta) as StoredOutcome | null;
    if (!matching?.id || !run.twitch_prediction_id) {
      return cancelRun(run, 'outcome_match_invalid');
    }
    await setStatus(run, 'resolving', { failure_reason: null });
    await deps.predictions.resolveById(
      run.broadcaster_id,
      run.twitch_prediction_id,
      matching.id,
    );
    return setStatus(run, 'resolved', {
      resolved_at: new Date(deps.now()),
      cooldown_until: new Date(deps.now() + repeatCooldownMs),
      failure_reason: null,
    });
  }

  async function advanceNextResult(
    run: RunRecord,
    config: PredictionAutomationConfigData,
    channel: ChannelRecord,
  ): Promise<RunRecord> {
    if (run.twitch_prediction_id) {
      const exact = await deps.predictions.getById(
        run.broadcaster_id,
        run.twitch_prediction_id,
      );
      if (exact?.status === 'RESOLVED') {
        return setStatus(run, 'resolved', {
          failure_reason: 'resolved_on_twitch',
          resolved_at: new Date(deps.now()),
          cooldown_until: new Date(deps.now() + repeatCooldownMs),
        });
      }
      if (exact?.status === 'CANCELED') {
        return setStatus(run, 'canceled', {
          failure_reason: 'canceled_on_twitch',
          resolved_at: new Date(deps.now()),
          cooldown_until: new Date(deps.now() + repeatCooldownMs),
        });
      }
    }
    if (run.status === 'voting' && run.prediction_created_at) {
      const votingEndsAt = run.resolution_deadline_at
        ? new Date(run.resolution_deadline_at).getTime() - scoreChangeTimeoutMs
        : new Date(run.prediction_created_at).getTime()
          + config.votingWindowSeconds * 1000;
      if (deps.now() < votingEndsAt) return run;
      run = await maybeLockOrRetry(run, {
        resolution_deadline_at: new Date(votingEndsAt + scoreChangeTimeoutMs),
      });
    }
    if (run.status !== 'tracking' || !channel.player_id) return run;
    return settleNextResult(run, await deps.getCurrentScore(channel.player_id));
  }

  async function evaluateStream(
    channelId: number,
    stream: LiveStreamIdentity,
    options: { bypassDelay?: boolean } = {},
  ): Promise<RunRecord> {
    const config = await deps.loadConfig(channelId);
    const existing = await deps.findRun(channelId, stream.id);
    const activeStatuses: AutoPredictionRunStatus[] = [
      'voting',
      'tracking',
      'resolving',
    ];
    if (!config.enabled && (!existing || !activeStatuses.includes(existing.status))) {
      return {
        id: 0,
        broadcaster_id: channelId,
        twitch_stream_id: stream.id,
        status: 'skipped',
        failure_reason: 'automation_disabled',
      };
    }
    let run = existing || await ensureRun(channelId, stream.id, config.mode);
    const runMode = (run.mode || config.mode) as PredictionAutomationConfigData['mode'];
    if (runMode === 'stream_total' && run.status === 'voting' && run.prediction_created_at) {
      const votingEndsAt = new Date(run.prediction_created_at).getTime()
        + config.votingWindowSeconds * 1000;
      if (deps.now() >= votingEndsAt) run = await maybeLockOrRetry(run);
    }
    if (runMode === 'stream_total' && activeStatuses.includes(run.status)) {
      return run;
    }
    if (runMode === 'next_result' && activeStatuses.includes(run.status)) {
      const activeChannel = await deps.loadChannel(channelId);
      return activeChannel
        ? advanceNextResult(run, config, activeChannel)
        : run;
    }
    if (stream.gameName.trim().toLowerCase() !== 'the finals') {
      return setStatus(run, 'waiting_for_category');
    }

    const channel = await deps.loadChannel(channelId);
    if (!hasPredictionAutomationAccess(channel)) {
      return setStatus(run, 'needs_attention', { failure_reason: 'subscription_required' });
    }
    if (!channel?.player_id) {
      return setStatus(run, 'needs_attention', { failure_reason: 'linked_player_required' });
    }
    if (!Number.isFinite(channel.session_start_rs)) {
      return setStatus(run, 'waiting_for_start_rs', { failure_reason: 'starting_rs_unavailable' });
    }

    // Empty-prediction retry: a cycle canceled for zero votes re-opens after a cooldown,
    // up to a per-stream cap, for both modes. After spawning the next cycle the status is
    // 'scheduled', so it flows through normal creation below.
    if (run.status === 'canceled' && run.failure_reason === 'no_votes') {
      const cooldownUntil = run.cooldown_until
        ? new Date(run.cooldown_until).getTime()
        : 0;
      if (deps.now() < cooldownUntil) return run;
      if (await deps.countEmptyRetries(channelId, stream.id) >= maxEmptyRetries) return run;
      try {
        run = await createCycle(
          channelId,
          stream.id,
          runMode,
          Number(run.cycle_index || 1) + 1,
        );
      } catch (error) {
        const duplicate = await deps.findRun(channelId, stream.id);
        if (duplicate) run = duplicate;
        else throw error;
      }
    }

    if (config.mode === 'next_result') {
      if (['resolved', 'canceled'].includes(run.status)) {
        const cooldownUntil = run.cooldown_until
          ? new Date(run.cooldown_until).getTime()
          : 0;
        if (deps.now() < cooldownUntil) return run;
        const currentScore = await deps.getCurrentScore(channel.player_id);
        if (!Number.isFinite(currentScore)) return run;
        if (
          run.failure_reason === 'score_change_timeout'
          && Number(currentScore) === Number(run.baseline_rs)
        ) {
          return run;
        }
        try {
          run = await createCycle(
            channelId,
            stream.id,
            config.mode,
            Number(run.cycle_index || 1) + 1,
          );
        } catch (error) {
          const duplicate = await deps.findRun(channelId, stream.id);
          if (duplicate) run = duplicate;
          else throw error;
        }
      }
    } else if (['voting', 'tracking', 'resolving', 'resolved', 'canceled'].includes(run.status)) {
      return run;
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

    if (run.status === 'creating') {
      return setStatus(run, 'needs_attention', {
        failure_reason: 'prediction_creation_uncertain',
      });
    }
    const claimed = await deps.claimRun(run);
    if (!claimed) {
      return (await deps.findRun(channelId, stream.id)) || run;
    }
    const baselineRs = config.mode === 'next_result'
      ? await deps.getCurrentScore(channel.player_id)
      : null;
    if (config.mode === 'next_result' && !Number.isFinite(baselineRs)) {
      return setStatus(run, 'waiting_for_start_rs', {
        failure_reason: 'ranked_score_unavailable',
      });
    }
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
    const voting = await setStatus(run, 'voting', {
      twitch_prediction_id: created.id,
      twitch_outcome_ids_json: JSON.stringify(storedOutcomes),
      prediction_created_at: new Date(deps.now()),
      baseline_rs: baselineRs,
      resolution_deadline_at: config.mode === 'next_result'
        ? new Date(
          deps.now()
          + config.votingWindowSeconds * 1000
          + scoreChangeTimeoutMs,
        )
        : null,
      failure_reason: null,
    });
    try {
      await deps.announce(
        channel.username,
        `Prediction started: "${config.question}" Vote now with Channel Points!`,
      );
    } catch (error) {
      logger.warn('[RankedPredictionAutomation] Chat announcement failed', {
        channel: channel.username,
        predictionId: created.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return voting;
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
    if (!channel?.player_id) {
      return cancelRun(run, 'ranked_score_unavailable');
    }
    const finalScore = await deps.getCurrentScore(channel.player_id);
    if (!Number.isFinite(finalScore)) {
      return cancelRun(run, 'ranked_score_unavailable');
    }

    if (run.mode === 'next_result') {
      // next_result settles against the per-cycle baseline, not the stream's starting RS.
      if (!Number.isFinite(run.baseline_rs)) {
        return cancelRun(run, 'ranked_score_unavailable');
      }
      return Number(finalScore) !== Number(run.baseline_rs)
        ? settleNextResult(run, finalScore)
        : cancelRun(run, 'stream_ended_before_score_change');
    }

    if (!Number.isFinite(channel.session_start_rs)) {
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
      if (valid.enabled && !hasPredictionAutomationAccess(channel)) {
        throw new PredictionAutomationPrerequisiteError(
          'Automatic predictions are currently available to subscribers and test users.',
        );
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
        // Same lock decision as the poller, so a dashboard refresh can't flip an empty
        // prediction to 'tracking' and bypass the no-votes cancel/retry.
        if (deps.now() >= votingEndsAt) run = await maybeLockOrRetry(run);
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
