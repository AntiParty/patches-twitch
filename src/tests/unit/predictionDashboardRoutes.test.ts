import assert from 'assert';
import {
  createPredictionRouteHandlers,
  createPredictionRoutes,
} from '@/routes/user/predictions.routes';
import {
  PredictionPresetContentError,
  PredictionPresetValidationError,
} from '@/services/predictionPreset.service';

type Handler = (req: any, res: any) => Promise<any>;

function createResponse() {
  return {
    statusCode: 200,
    body: undefined as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: any) {
      this.body = body;
      return this;
    },
  };
}

function createHarness(overrides: Record<string, any> = {}) {
  const calls: Record<string, any[]> = {
    loadById: [],
    loadByUsername: [],
    list: [],
    saveInput: [],
    get: [],
    delete: [],
    status: [],
    errors: [],
  };
  const preset = {
    id: 11,
    channelId: 7,
    alias: 'ranked',
    title: 'How will ranked go?',
    outcomes: ['Down', 'Even', 'Up'],
    durationSeconds: 120,
  };
  const dependencies = {
    loadChannelById: async (id: number) => {
      calls.loadById.push(id);
      return { id: 7, username: 'streamer' };
    },
    loadChannelByUsername: async (username: string) => {
      calls.loadByUsername.push(username);
      return { id: 7, username: 'streamer' };
    },
    presetService: {
      list: async (channelId: number) => {
        calls.list.push(channelId);
        return [preset];
      },
      saveInput: async (channelId: number, input: unknown, context: unknown) => {
        calls.saveInput.push({ channelId, input, context });
        return 'created' as const;
      },
      get: async (channelId: number, alias: string) => {
        calls.get.push({ channelId, alias });
        return { ...preset, alias };
      },
      delete: async (channelId: number, alias: string) => {
        calls.delete.push({ channelId, alias });
        return true;
      },
    },
    predictionService: {
      getAuthorizationStatus: async (channelId: number) => {
        calls.status.push(channelId);
        return { state: 'ready' };
      },
    },
    logger: {
      error: (...args: any[]) => calls.errors.push(args),
    },
    ...overrides,
  };
  return {
    calls,
    preset,
    handlers: createPredictionRouteHandlers(dependencies as any),
  };
}

async function invoke(
  handler: Handler,
  request: Record<string, any> = {},
) {
  const req = {
    session: { channelId: 7, twitchUsername: 'streamer' },
    body: {},
    query: {},
    params: {},
    ...request,
  };
  const res = createResponse();
  await handler(req, res);
  return res;
}

describe('prediction dashboard route handlers', () => {
  it('lists presets scoped to the authenticated session channel', async () => {
    const harness = createHarness();
    const res = await invoke(harness.handlers.list, {
      body: { channelId: 999 },
      query: { channelId: '999' },
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { presets: [harness.preset] });
    assert.deepEqual(harness.calls.loadById, [7]);
    assert.deepEqual(harness.calls.list, [7]);
  });

  it('falls back to the authenticated Twitch username when channelId is absent', async () => {
    const harness = createHarness();
    const res = await invoke(harness.handlers.list, {
      session: { twitchUsername: 'streamer' },
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(harness.calls.loadById, []);
    assert.deepEqual(harness.calls.loadByUsername, ['streamer']);
    assert.deepEqual(harness.calls.list, [7]);
  });

  it('returns 404 when the authenticated session has no channel', async () => {
    const harness = createHarness({
      loadChannelById: async () => null,
      loadChannelByUsername: async () => null,
    });
    const res = await invoke(harness.handlers.list);

    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { error: 'Channel not found.' });
  });

  it('creates a preset with dashboard audit context and returns normalized data', async () => {
    const harness = createHarness();
    const input = {
      alias: 'Ranked',
      title: 'How will ranked go?',
      outcomes: ['Down', 'Up'],
      durationSeconds: 120,
      channelId: 999,
    };
    const res = await invoke(harness.handlers.create, { body: input });

    assert.equal(res.statusCode, 200);
    assert.equal(harness.calls.saveInput[0].channelId, 7);
    assert.deepEqual(harness.calls.saveInput[0].input, input);
    assert.deepEqual(harness.calls.saveInput[0].context, {
      actor: 'streamer',
      channel: 'streamer',
      command: 'dashboard:prediction-preset',
    });
    assert.deepEqual(harness.calls.get[0], { channelId: 7, alias: 'Ranked' });
    assert.equal(res.body.operation, 'created');
    assert.equal(res.body.preset.alias, 'Ranked');
  });

  it('uses the PUT path alias instead of a body alias', async () => {
    const harness = createHarness();
    const res = await invoke(harness.handlers.update, {
      params: { alias: 'path-alias' },
      body: {
        alias: 'body-alias',
        title: 'Updated title',
        outcomes: ['One', 'Two'],
        durationSeconds: 60,
        channelId: 999,
      },
    });

    assert.equal(res.statusCode, 200);
    assert.equal((harness.calls.saveInput[0].input as any).alias, 'path-alias');
    assert.deepEqual(harness.calls.get[0], { channelId: 7, alias: 'path-alias' });
  });

  it('deletes a session-scoped preset', async () => {
    const harness = createHarness();
    const res = await invoke(harness.handlers.remove, {
      params: { alias: 'ranked' },
      body: { channelId: 999 },
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: true, alias: 'ranked' });
    assert.deepEqual(harness.calls.delete, [{ channelId: 7, alias: 'ranked' }]);
  });

  it('returns 404 when a preset cannot be deleted', async () => {
    const harness = createHarness({
      presetService: {
        list: async () => [],
        saveInput: async () => 'created',
        get: async () => null,
        delete: async () => false,
      },
    });
    const res = await invoke(harness.handlers.remove, {
      params: { alias: 'missing' },
    });

    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { error: 'Prediction preset not found.' });
  });

  it('returns stable prediction authorization status', async () => {
    const harness = createHarness();
    const res = await invoke(harness.handlers.status);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { state: 'ready' });
    assert.deepEqual(harness.calls.status, [7]);
  });

  it('maps malformed preset validation to its exact safe message', async () => {
    const harness = createHarness({
      presetService: {
        list: async () => [],
        saveInput: async () => {
          throw new PredictionPresetValidationError('Prediction preset payload is invalid.');
        },
        get: async () => null,
        delete: async () => false,
      },
    });
    const res = await invoke(harness.handlers.create, { body: {} });

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { error: 'Prediction preset payload is invalid.' });
  });

  it('maps blocked content to a fixed safe message', async () => {
    const harness = createHarness({
      presetService: {
        list: async () => [],
        saveInput: async () => {
          throw new PredictionPresetContentError('title');
        },
        get: async () => null,
        delete: async () => false,
      },
    });
    const res = await invoke(harness.handlers.create);

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { error: 'Preset contains blocked content.' });
  });

  it('hides unexpected errors and tokens while logging with a module prefix', async () => {
    const secret = 'oauth:super-secret-token';
    const harness = createHarness({
      predictionService: {
        getAuthorizationStatus: async () => {
          throw new Error(`Twitch failed with ${secret}`);
        },
      },
    });
    const res = await invoke(harness.handlers.status);

    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: 'Prediction request failed.' });
    assert.equal(JSON.stringify(res.body).includes(secret), false);
    assert.equal(String(harness.calls.errors[0][0]).startsWith('[PredictionDashboard]'), true);
  });
});

describe('prediction dashboard router wiring', () => {
  it('protects all routes with auth and mutations with CSRF', () => {
    const auth = (_req: any, _res: any, next: any) => next();
    const csrf = (_req: any, _res: any, next: any) => next();
    const router: any = createPredictionRoutes({
      requireUserAPI: auth,
      csrfProtection: csrf,
      loadChannelById: async () => ({ id: 7, username: 'streamer' }),
      loadChannelByUsername: async () => ({ id: 7, username: 'streamer' }),
    });
    const layers = router.stack.filter((layer: any) => layer.route);
    const byPath = new Map(layers.map((layer: any) => [layer.route.path, layer.route.stack]));

    assert.equal((byPath.get('/api/user/prediction-presets') as any[]).length >= 2, true);
    for (const layer of layers) {
      const middleware = layer.route.stack.map((entry: any) => entry.handle);
      assert.equal(middleware.includes(auth), true, `${layer.route.path} should require auth`);
      const method = Object.keys(layer.route.methods)[0];
      assert.equal(
        middleware.includes(csrf),
        method === 'post' || method === 'put' || method === 'delete',
        `${method.toUpperCase()} ${layer.route.path} CSRF mismatch`,
      );
    }
  });
});
