import assert from 'assert';
import {
  createPredictionRouteHandlers,
  createPredictionRoutes,
} from '@/routes/user/predictions.routes';
import {
  PredictionPresetContentError,
  PredictionPresetValidationError,
} from '@/services/predictionPreset.service';
import {
  PredictionActiveConflictError,
  PredictionInvalidOutcomeError,
  PredictionNoActiveError,
  PredictionReauthRequiredError,
  PredictionTemporaryError,
  PredictionUnavailableError,
} from '@/services/twitchPredictions.service';

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
    current: [],
    start: [],
    resolve: [],
    cancel: [],
    automationGet: [],
    automationSave: [],
    automationStart: [],
    automationCancel: [],
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
      getCurrent: async (channelId: number) => {
        calls.current.push(channelId);
        return {
          id: 'prediction-1',
          title: 'How will ranked go?',
          status: 'ACTIVE',
          outcomes: [
            { id: 'outcome-1', title: 'Down' },
            { id: 'outcome-2', title: 'Up' },
          ],
          accessToken: 'must-not-leak',
        };
      },
      start: async (channelId: number, selectedPreset: unknown) => {
        calls.start.push({ channelId, preset: selectedPreset });
        return {
          id: 'prediction-2',
          title: 'How will ranked go?',
          status: 'ACTIVE',
          outcomes: [
            { id: 'outcome-1', title: 'Down' },
            { id: 'outcome-2', title: 'Up' },
          ],
          raw: { token: 'must-not-leak' },
        };
      },
      resolve: async (channelId: number, selection: string) => {
        calls.resolve.push({ channelId, selection });
        return {
          id: 'prediction-1',
          title: 'How will ranked go?',
          status: 'RESOLVED',
          outcomes: [{ id: 'outcome-2', title: 'Up' }],
        };
      },
      cancel: async (channelId: number) => {
        calls.cancel.push(channelId);
        return {
          id: 'prediction-1',
          title: 'How will ranked go?',
          status: 'CANCELED',
          outcomes: [{ id: 'outcome-1', title: 'Down' }],
        };
      },
    },
    automationService: {
      getConfig: async (channelId: number) => {
        calls.automationGet.push(channelId);
        return {
          enabled: false,
          mode: 'stream_total',
          startDelaySeconds: 600,
          votingWindowSeconds: 600,
          question: 'How much RS will I gain this stream?',
          outcomes: [
            { label: 'Down', minDelta: null, maxDelta: -1 },
            { label: 'Up', minDelta: 0, maxDelta: null },
          ],
        };
      },
      saveConfig: async (channelId: number, input: any) => {
        calls.automationSave.push({ channelId, input });
        return input;
      },
      getCurrentRun: async () => null,
      getStatus: async (channelId: number) => {
        calls.automationGet.push(channelId);
        return {
          config: {
            enabled: false,
            mode: 'stream_total',
            startDelaySeconds: 600,
            votingWindowSeconds: 600,
            question: 'How much RS will I gain this stream?',
            outcomes: [
              { label: 'Down', minDelta: null, maxDelta: -1 },
              { label: 'Up', minDelta: 0, maxDelta: null },
            ],
          },
          run: null,
          isLive: false,
          category: null,
          startingRs: null,
          latestRs: null,
          delta: null,
          secondsUntilStart: null,
        };
      },
      evaluateStream: async (channelId: number, stream: any, options: any) => {
        calls.automationStart.push({ channelId, stream, options });
        return { id: 1, status: 'voting' };
      },
      cancelCurrent: async (channelId: number) => {
        calls.automationCancel.push(channelId);
        return { id: 1, status: 'canceled' };
      },
    },
    getLiveStreams: async () => [{
      id: 'stream-1',
      username: 'streamer',
      gameId: 'game-1',
      gameName: 'THE FINALS',
      startedAt: '2026-06-11T12:00:00Z',
    }],
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

describe('Prediction dashboard routes', () => {
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

  it('redacts unexpected error details from prediction dashboard logs', async () => {
    const accessToken = 'oauth:super-secret-access-token';
    const refreshToken = 'super-secret-refresh-token';
    const error = Object.assign(new Error(`Twitch failed with ${accessToken}`), {
      name: 'AxiosError',
      code: 'ERR_BAD_RESPONSE',
      response: {
        status: 503,
        data: { message: `upstream leaked ${refreshToken}` },
      },
      config: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      request: { accessToken, refreshToken },
    });
    const harness = createHarness({
      predictionService: {
        getAuthorizationStatus: async () => {
          throw error;
        },
      },
    });
    const res = await invoke(harness.handlers.status);

    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: 'Prediction request failed.' });
    assert.deepEqual(harness.calls.errors, [[
      '[PredictionDashboard] Request failed',
      {
        operation: 'status',
        name: 'AxiosError',
        status: 503,
        code: 'ERR_BAD_RESPONSE',
      },
    ]]);
    const serializedLogs = JSON.stringify(harness.calls.errors);
    assert.equal(serializedLogs.includes(accessToken), false);
    assert.equal(serializedLogs.includes(refreshToken), false);
    assert.equal(harness.calls.errors[0].includes(error), false);
  });

  it('returns the current prediction scoped to the session channel without raw fields', async () => {
    const harness = createHarness();
    const res = await invoke(harness.handlers.current, {
      body: { channelId: 999 },
      query: { channelId: '999' },
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(harness.calls.current, [7]);
    assert.deepEqual(res.body, {
      prediction: {
        id: 'prediction-1',
        title: 'How will ranked go?',
        status: 'ACTIVE',
        outcomes: [
          { id: 'outcome-1', title: 'Down' },
          { id: 'outcome-2', title: 'Up' },
        ],
      },
    });
    assert.equal(JSON.stringify(res.body).includes('must-not-leak'), false);
  });

  it('returns null when there is no current prediction', async () => {
    const harness = createHarness({
      predictionService: {
        getAuthorizationStatus: async () => ({ state: 'ready' }),
        getCurrent: async () => null,
        start: async () => null,
        resolve: async () => null,
        cancel: async () => null,
      },
    });
    const res = await invoke(harness.handlers.current);

    assert.deepEqual(res.body, { prediction: null });
  });

  it('starts a stored preset by alias for the session channel', async () => {
    const harness = createHarness();
    const res = await invoke(harness.handlers.start, {
      body: { alias: 'ranked', channelId: 999 },
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(harness.calls.get, [{ channelId: 7, alias: 'ranked' }]);
    assert.deepEqual(harness.calls.start, [{ channelId: 7, preset: harness.preset }]);
    assert.equal(res.body.prediction.id, 'prediction-2');
    assert.equal(JSON.stringify(res.body).includes('must-not-leak'), false);
  });

  it('returns 404 when starting a missing preset', async () => {
    const harness = createHarness({
      presetService: {
        list: async () => [],
        saveInput: async () => 'created',
        get: async () => null,
        delete: async () => false,
      },
    });
    const res = await invoke(harness.handlers.start, { body: { alias: 'missing' } });

    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { error: 'Prediction preset not found.' });
    assert.deepEqual(harness.calls.start, []);
  });

  for (const alias of [undefined, null, '', '   ', 42, []]) {
    it(`rejects malformed start aliases: ${JSON.stringify(alias)}`, async () => {
      const harness = createHarness();
      const res = await invoke(harness.handlers.start, { body: { alias } });

      assert.equal(res.statusCode, 400);
      assert.deepEqual(res.body, { error: 'Prediction alias is required.' });
      assert.deepEqual(harness.calls.get, []);
    });
  }

  it('resolves by an outcome number converted to a string', async () => {
    const harness = createHarness();
    const res = await invoke(harness.handlers.resolve, { body: { selection: 2 } });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(harness.calls.resolve, [{ channelId: 7, selection: '2' }]);
    assert.equal(res.body.prediction.status, 'RESOLVED');
  });

  it('resolves by exact outcome text', async () => {
    const harness = createHarness();
    await invoke(harness.handlers.resolve, { body: { selection: 'Up' } });

    assert.deepEqual(harness.calls.resolve, [{ channelId: 7, selection: 'Up' }]);
  });

  for (const selection of [undefined, null, '', '   ', [], {}]) {
    it(`rejects malformed resolve selections: ${JSON.stringify(selection)}`, async () => {
      const harness = createHarness();
      const res = await invoke(harness.handlers.resolve, { body: { selection } });

      assert.equal(res.statusCode, 400);
      assert.deepEqual(res.body, { error: 'Prediction outcome is required.' });
      assert.deepEqual(harness.calls.resolve, []);
    });
  }

  it('cancels the current prediction for the session channel', async () => {
    const harness = createHarness();
    const res = await invoke(harness.handlers.cancel, {
      body: { channelId: 999 },
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(harness.calls.cancel, [7]);
    assert.equal(res.body.prediction.status, 'CANCELED');
  });

  it('maps prediction domain errors to safe dashboard responses', async () => {
    const cases = [
      {
        error: new PredictionReauthRequiredError('https://finalsrs.com/reauth'),
        status: 403,
        body: {
          error: 'Prediction authorization required.',
          state: 'reauth_required',
          reauthUrl: '/reauth',
        },
      },
      {
        error: new PredictionNoActiveError('secret upstream detail'),
        status: 409,
        body: { error: 'There is no active prediction.' },
      },
      {
        error: new PredictionActiveConflictError('secret upstream detail'),
        status: 409,
        body: { error: 'A prediction is already active.' },
      },
      {
        error: new PredictionInvalidOutcomeError(['1. Down', '2. Up']),
        status: 400,
        body: {
          error: 'That outcome was not found.',
          choices: ['1. Down', '2. Up'],
        },
      },
      {
        error: new PredictionUnavailableError('secret upstream detail'),
        status: 403,
        body: {
          error: 'Channel Points Predictions require Twitch Affiliate or Partner status.',
        },
      },
      {
        error: new PredictionTemporaryError('secret upstream detail'),
        status: 503,
        body: { error: 'Twitch predictions are temporarily unavailable.' },
      },
    ];

    for (const item of cases) {
      const harness = createHarness({
        predictionService: {
          getAuthorizationStatus: async () => ({ state: 'ready' }),
          getCurrent: async () => {
            throw item.error;
          },
          start: async () => null,
          resolve: async () => null,
          cancel: async () => null,
        },
      });
      const res = await invoke(harness.handlers.current);

      assert.equal(res.statusCode, item.status);
      assert.deepEqual(res.body, item.body);
      assert.equal(JSON.stringify(res.body).includes('secret upstream detail'), false);
      assert.deepEqual(harness.calls.errors, []);
    }
  });

  it('reads and updates automatic prediction settings for the session channel', async () => {
    const harness = createHarness();
    const current = await invoke(harness.handlers.automation);
    assert.equal(current.statusCode, 200);
    assert.equal(current.body.config.enabled, false);

    const input = {
      enabled: true,
      mode: 'next_result',
      startDelaySeconds: 600,
      votingWindowSeconds: 600,
      question: 'How much RS?',
      outcomes: [
        { label: 'Down', minDelta: null, maxDelta: -1 },
        { label: 'Up', minDelta: 0, maxDelta: null },
      ],
    };
    const updated = await invoke(harness.handlers.updateAutomation, { body: input });
    assert.equal(updated.statusCode, 200);
    assert.deepEqual(harness.calls.automationSave, [{ channelId: 7, input }]);
  });

  it('starts immediately and cancels through the shared automation service', async () => {
    const harness = createHarness();
    const started = await invoke(harness.handlers.startAutomation);
    assert.equal(started.body.run.status, 'voting');
    assert.deepEqual(harness.calls.automationStart[0].options, { bypassDelay: true });

    const canceled = await invoke(harness.handlers.cancelAutomation);
    assert.equal(canceled.body.run.status, 'canceled');
    assert.deepEqual(harness.calls.automationCancel, [7]);
  });
});

describe('Prediction dashboard routes wiring', () => {
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
    assert.equal(byPath.has('/api/user/predictions/current'), true);
    assert.equal(byPath.has('/api/user/predictions/start'), true);
    assert.equal(byPath.has('/api/user/predictions/resolve'), true);
    assert.equal(byPath.has('/api/user/predictions/cancel'), true);
    assert.equal(byPath.has('/api/user/predictions/automation'), true);
    assert.equal(byPath.has('/api/user/predictions/automation/start'), true);
    assert.equal(byPath.has('/api/user/predictions/automation/cancel'), true);
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

  it('gates only automatic prediction routes with subscription access', () => {
    const auth = (_req: any, _res: any, next: any) => next();
    const csrf = (_req: any, _res: any, next: any) => next();
    const subscription = (_req: any, _res: any, next: any) => next();
    const router: any = createPredictionRoutes({
      requireUserAPI: auth,
      csrfProtection: csrf,
      requireSubscriptionAPI: subscription,
      loadChannelById: async () => ({ id: 7, username: 'streamer' }),
      loadChannelByUsername: async () => ({ id: 7, username: 'streamer' }),
    });
    const layers = router.stack.filter((layer: any) => layer.route);

    for (const layer of layers) {
      const middleware = layer.route.stack.map((entry: any) => entry.handle);
      const automatic = String(layer.route.path).startsWith('/api/user/predictions/automation');
      assert.equal(
        middleware.includes(subscription),
        automatic,
        `${layer.route.path} subscription gate mismatch`,
      );
    }
  });
});
