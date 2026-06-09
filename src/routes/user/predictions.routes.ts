import { Router } from 'express';
import { Channel } from '@/db';
import { requireUserAPI } from '@/middleware/auth.middleware';
import { csrfProtection } from '@/middleware/csrf.middleware';
import {
  PredictionPresetContentError,
  PredictionPresetValidationError,
  predictionPresetService,
} from '@/services/predictionPreset.service';
import { twitchPredictionsService } from '@/services/twitchPredictions.service';
import logger from '@/util/logger';

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
  predictionService: Pick<typeof twitchPredictionsService, 'getAuthorizationStatus'>;
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

  return router;
}

export default createPredictionRoutes();
