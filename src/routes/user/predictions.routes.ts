import { Router } from 'express';
import { Channel } from '@/db';
import { requireUserAPI } from '@/middleware/auth.middleware';
import { csrfProtection } from '@/middleware/csrf.middleware';
import {
  PredictionPresetContentError,
  PredictionPresetValidationError,
  predictionPresetService,
} from '@/services/predictionPreset.service';
import {
  PredictionActiveConflictError,
  PredictionInvalidOutcomeError,
  PredictionNoActiveError,
  PredictionReauthRequiredError,
  PredictionTemporaryError,
  PredictionUnavailableError,
  TwitchPrediction,
  twitchPredictionsService,
} from '@/services/twitchPredictions.service';
import logger from '@/util/logger';
import {
  PredictionAutomationPrerequisiteError,
  rankedPredictionAutomationService,
} from '@/services/rankedPredictionAutomation.service';
import {
  PredictionAutomationValidationError,
} from '@/models/predictionAutomation';
import { getLiveStreamsForUsers } from '@/util/twitchUtils';

interface ChannelIdentity {
  id: number;
  username: string;
}

interface PredictionRouteDependencies {
  loadChannelById: (channelId: number) => Promise<ChannelIdentity | null>;
  loadChannelByUsername: (username: string) => Promise<ChannelIdentity | null>;
  presetService: Pick<
    typeof predictionPresetService,
    'list' | 'saveInput' | 'get' | 'delete'
  >;
  predictionService: Pick<
    typeof twitchPredictionsService,
    'getAuthorizationStatus' | 'getCurrent' | 'start' | 'resolve' | 'cancel'
  >;
  automationService: Pick<
    typeof rankedPredictionAutomationService,
    'getConfig' | 'saveConfig' | 'getCurrentRun' | 'getStatus' | 'evaluateStream' | 'cancelCurrent'
  >;
  getLiveStreams: typeof getLiveStreamsForUsers;
  logger: Pick<typeof logger, 'error'>;
}

interface PredictionRouterDependencies extends Partial<PredictionRouteDependencies> {
  requireUserAPI?: typeof requireUserAPI;
  csrfProtection?: typeof csrfProtection;
}

const productionDependencies: PredictionRouteDependencies = {
  loadChannelById: async (channelId) => {
    const channel = await Channel.findByPk(channelId) as any;
    return channel ? { id: Number(channel.id), username: String(channel.username) } : null;
  },
  loadChannelByUsername: async (username) => {
    const channel = await Channel.findOne({ where: { username } }) as any;
    return channel ? { id: Number(channel.id), username: String(channel.username) } : null;
  },
  presetService: predictionPresetService,
  predictionService: twitchPredictionsService,
  automationService: rankedPredictionAutomationService,
  getLiveStreams: getLiveStreamsForUsers,
  logger,
};

function errorResponse(
  error: unknown,
  res: any,
  dependencies: PredictionRouteDependencies,
  operation: string,
) {
  if (error instanceof PredictionPresetValidationError) {
    return res.status(400).json({ error: error.message });
  }
  if (error instanceof PredictionPresetContentError) {
    return res.status(400).json({ error: 'Preset contains blocked content.' });
  }
  if (error instanceof PredictionAutomationValidationError) {
    return res.status(400).json({ error: error.message });
  }
  if (error instanceof PredictionAutomationPrerequisiteError) {
    return res.status(409).json({ error: error.message });
  }
  if (error instanceof PredictionReauthRequiredError) {
    return res.status(403).json({
      error: 'Prediction authorization required.',
      state: 'reauth_required',
      reauthUrl: '/reauth',
    });
  }
  if (error instanceof PredictionNoActiveError) {
    return res.status(409).json({ error: 'There is no active prediction.' });
  }
  if (error instanceof PredictionActiveConflictError) {
    return res.status(409).json({ error: 'A prediction is already active.' });
  }
  if (error instanceof PredictionInvalidOutcomeError) {
    return res.status(400).json({
      error: 'That outcome was not found.',
      choices: error.choices,
    });
  }
  if (error instanceof PredictionUnavailableError) {
    return res.status(403).json({
      error: 'Channel Points Predictions require Twitch Affiliate or Partner status.',
    });
  }
  if (error instanceof PredictionTemporaryError) {
    return res.status(503).json({
      error: 'Twitch predictions are temporarily unavailable.',
    });
  }
  const metadata: Record<string, string | number> = { operation };
  if (typeof error === 'object' && error !== null) {
    const candidate = error as Record<string, any>;
    if (
      typeof candidate.name === 'string'
      && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(candidate.name)
    ) {
      metadata.name = candidate.name;
    }
    const status = candidate.response?.status ?? candidate.status;
    if (Number.isInteger(status) && status >= 100 && status <= 599) {
      metadata.status = status;
    }
    if (
      typeof candidate.code === 'string'
      && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(candidate.code)
    ) {
      metadata.code = candidate.code;
    }
  }
  dependencies.logger.error('[PredictionDashboard] Request failed', metadata);
  return res.status(500).json({ error: 'Prediction request failed.' });
}

function serializePrediction(prediction: TwitchPrediction | null): TwitchPrediction | null {
  if (!prediction) return null;
  return {
    id: String(prediction.id),
    title: String(prediction.title),
    status: prediction.status,
    outcomes: Array.isArray(prediction.outcomes)
      ? prediction.outcomes.map((outcome) => ({
        id: String(outcome.id),
        title: String(outcome.title),
      }))
      : [],
  };
}

export function createPredictionRouteHandlers(
  overrides: Partial<PredictionRouteDependencies> = {},
) {
  const dependencies = { ...productionDependencies, ...overrides };

  async function resolveChannel(req: any): Promise<ChannelIdentity | null> {
    const sessionChannelId = Number(req.session?.channelId);
    if (Number.isInteger(sessionChannelId) && sessionChannelId > 0) {
      const channel = await dependencies.loadChannelById(sessionChannelId);
      if (channel) return channel;
    }
    const username = req.session?.twitchUsername;
    return typeof username === 'string' && username
      ? dependencies.loadChannelByUsername(username)
      : null;
  }

  async function withChannel(
    req: any,
    res: any,
    operationName: string,
    operation: (channel: ChannelIdentity) => Promise<any>,
  ) {
    try {
      const channel = await resolveChannel(req);
      if (!channel) return res.status(404).json({ error: 'Channel not found.' });
      return await operation(channel);
    } catch (error: unknown) {
      return errorResponse(error, res, dependencies, operationName);
    }
  }

  return {
    list: (req: any, res: any) => withChannel(req, res, 'list', async (channel) => {
      const presets = await dependencies.presetService.list(channel.id);
      return res.json({ presets });
    }),

    create: (req: any, res: any) => withChannel(req, res, 'create', async (channel) => {
      const operation = await dependencies.presetService.saveInput(
        channel.id,
        req.body,
        {
          actor: String(req.session.twitchUsername),
          channel: channel.username,
          command: 'dashboard:prediction-preset',
        },
      );
      const alias = typeof req.body?.alias === 'string' ? req.body.alias : '';
      const preset = await dependencies.presetService.get(channel.id, alias);
      return res.json({ operation, preset });
    }),

    update: (req: any, res: any) => withChannel(req, res, 'update', async (channel) => {
      const body = typeof req.body === 'object' && req.body !== null && !Array.isArray(req.body)
        ? { ...req.body, alias: req.params.alias }
        : { alias: req.params.alias };
      const operation = await dependencies.presetService.saveInput(
        channel.id,
        body,
        {
          actor: String(req.session.twitchUsername),
          channel: channel.username,
          command: 'dashboard:prediction-preset',
        },
      );
      const preset = await dependencies.presetService.get(channel.id, req.params.alias);
      return res.json({ operation, preset });
    }),

    remove: (req: any, res: any) => withChannel(req, res, 'remove', async (channel) => {
      const deleted = await dependencies.presetService.delete(channel.id, req.params.alias);
      if (!deleted) {
        return res.status(404).json({ error: 'Prediction preset not found.' });
      }
      return res.json({ success: true, alias: req.params.alias });
    }),

    status: (req: any, res: any) => withChannel(req, res, 'status', async (channel) => {
      const status = await dependencies.predictionService.getAuthorizationStatus(channel.id);
      return res.json(status);
    }),

    current: (req: any, res: any) => withChannel(req, res, 'current', async (channel) => {
      const prediction = await dependencies.predictionService.getCurrent(channel.id);
      return res.json({ prediction: serializePrediction(prediction) });
    }),

    start: (req: any, res: any) => withChannel(req, res, 'start', async (channel) => {
      const alias = typeof req.body?.alias === 'string' ? req.body.alias.trim() : '';
      if (!alias) {
        return res.status(400).json({ error: 'Prediction alias is required.' });
      }
      const preset = await dependencies.presetService.get(channel.id, alias);
      if (!preset) {
        return res.status(404).json({ error: 'Prediction preset not found.' });
      }
      const prediction = await dependencies.predictionService.start(channel.id, preset);
      return res.json({ prediction: serializePrediction(prediction) });
    }),

    resolve: (req: any, res: any) => withChannel(req, res, 'resolve', async (channel) => {
      const rawSelection = req.body?.selection;
      const selection = typeof rawSelection === 'string' || typeof rawSelection === 'number'
        ? String(rawSelection).trim()
        : '';
      if (!selection) {
        return res.status(400).json({ error: 'Prediction outcome is required.' });
      }
      const prediction = await dependencies.predictionService.resolve(channel.id, selection);
      return res.json({ prediction: serializePrediction(prediction) });
    }),

    cancel: (req: any, res: any) => withChannel(req, res, 'cancel', async (channel) => {
      const prediction = await dependencies.predictionService.cancel(channel.id);
      return res.json({ prediction: serializePrediction(prediction) });
    }),

    automation: (req: any, res: any) => withChannel(
      req,
      res,
      'automation',
      async (channel) => {
        const stream = (await dependencies.getLiveStreams([channel.username]))[0] || null;
        const status = await dependencies.automationService.getStatus(channel.id, stream);
        const run: any = status.run;
        return res.json({
          config: status.config,
          run: run ? {
            id: Number(run.id),
            streamId: String(run.twitch_stream_id),
            status: String(run.status),
            predictionId: run.twitch_prediction_id
              ? String(run.twitch_prediction_id)
              : null,
            failureReason: run.failure_reason ? String(run.failure_reason) : null,
            predictionCreatedAt: run.prediction_created_at || null,
            resolvedAt: run.resolved_at || null,
          } : null,
          live: {
            isLive: status.isLive,
            category: status.category,
            startingRs: status.startingRs,
            latestRs: status.latestRs,
            delta: status.delta,
            secondsUntilStart: status.secondsUntilStart,
          },
        });
      },
    ),

    updateAutomation: (req: any, res: any) => withChannel(
      req,
      res,
      'updateAutomation',
      async (channel) => {
        const body = req.body || {};
        const config = await dependencies.automationService.saveConfig(channel.id, {
          enabled: body.enabled,
          startDelaySeconds: body.startDelaySeconds ?? body.start_delay_seconds,
          votingWindowSeconds: body.votingWindowSeconds ?? body.voting_window_seconds,
          question: body.question,
          outcomes: body.outcomes,
        });
        return res.json({ config });
      },
    ),

    startAutomation: (req: any, res: any) => withChannel(
      req,
      res,
      'startAutomation',
      async (channel) => {
        const stream = (await dependencies.getLiveStreams([channel.username]))[0];
        if (!stream) return res.status(409).json({ error: 'The stream is not live.' });
        const run = await dependencies.automationService.evaluateStream(
          channel.id,
          stream,
          { bypassDelay: true },
        );
        return res.json({ run });
      },
    ),

    cancelAutomation: (req: any, res: any) => withChannel(
      req,
      res,
      'cancelAutomation',
      async (channel) => {
        const run = await dependencies.automationService.cancelCurrent(channel.id);
        if (!run) {
          return res.status(409).json({ error: 'There is no automatic prediction to cancel.' });
        }
        return res.json({ run });
      },
    ),
  };
}

export function createPredictionRoutes(
  dependencies: PredictionRouterDependencies = {},
) {
  const router = Router();
  const handlers = createPredictionRouteHandlers(dependencies);
  const auth = dependencies.requireUserAPI || requireUserAPI;
  const csrf = dependencies.csrfProtection || csrfProtection;

  router.get('/api/user/prediction-presets', auth, handlers.list);
  router.post('/api/user/prediction-presets', auth, csrf, handlers.create);
  router.put('/api/user/prediction-presets/:alias', auth, csrf, handlers.update);
  router.delete('/api/user/prediction-presets/:alias', auth, csrf, handlers.remove);
  router.get('/api/user/predictions/status', auth, handlers.status);
  router.get('/api/user/predictions/current', auth, handlers.current);
  router.post('/api/user/predictions/start', auth, csrf, handlers.start);
  router.post('/api/user/predictions/resolve', auth, csrf, handlers.resolve);
  router.post('/api/user/predictions/cancel', auth, csrf, handlers.cancel);
  router.get('/api/user/predictions/automation', auth, handlers.automation);
  router.put('/api/user/predictions/automation', auth, csrf, handlers.updateAutomation);
  router.post('/api/user/predictions/automation/start', auth, csrf, handlers.startAutomation);
  router.post('/api/user/predictions/automation/cancel', auth, csrf, handlers.cancelAutomation);

  return router;
}

export default createPredictionRoutes();
