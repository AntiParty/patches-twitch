import { strict as assert } from 'assert';
import {
  PredictionAuthorizationStatus,
  PredictionActiveConflictError,
  PredictionInvalidOutcomeError,
  PredictionNoActiveError,
  PredictionReauthRequiredError,
  PredictionTemporaryError,
  PredictionUnavailableError,
  TwitchPrediction,
  createTwitchPredictionsService,
} from '@/services/twitchPredictions.service';
import { decryptChannelAccessToken } from '@/util/twitchUtils';

function prediction(overrides: Partial<TwitchPrediction> = {}): TwitchPrediction {
  return {
    id: 'prediction-1',
    title: 'Will we win?',
    status: 'ACTIVE',
    outcomes: [
      { id: 'yes-id', title: 'Yes' },
      { id: 'no-id', title: 'No' },
    ],
    ...overrides,
  };
}

function createHarness(options: {
  scopes?: string[];
  validatedUserId?: string;
  responses?: Array<any>;
  refreshedToken?: string | null;
  channel?: any | null;
  accessToken?: string | null;
  validationError?: Error;
} = {}) {
  const requests: any[] = [];
  const validations: string[] = [];
  const responses = [...(options.responses || [])];
  let token = options.accessToken === undefined ? 'token-one' : options.accessToken;
  const defaultChannel = {
    id: 7,
    username: 'antiparty',
    twitch_user_id: 'broadcaster-1',
  };
  const channel = options.channel === undefined ? defaultChannel : options.channel;

  const service = createTwitchPredictionsService({
    request: async (config) => {
      requests.push(config);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next || { data: { data: [] } };
    },
    validateToken: async (accessToken) => {
      validations.push(accessToken);
      if (options.validationError) throw options.validationError;
      return {
        user_id: options.validatedUserId || 'broadcaster-1',
        scopes: options.scopes || ['channel:manage:predictions'],
      };
    },
    refreshAccessToken: async () => {
      token = options.refreshedToken === undefined ? 'token-two' : options.refreshedToken || token;
      return options.refreshedToken === null ? null : token;
    },
    loadChannel: async () => channel,
    getAccessToken: () => token,
    now: () => 1_000,
    validatePresetContent: async () => undefined,
  });

  return { service, requests, validations };
}

describe('Twitch predictions service', () => {
  it('can load and decrypt a legacy plain broadcaster token without node-fetch', () => {
    assert.equal(decryptChannelAccessToken({ access_token: 'plain-token' }), 'plain-token');
  });

  it('requires reauthorization when the broadcaster token lacks the prediction scope', async () => {
    const previousBaseUrl = process.env.BASE_URL;
    process.env.BASE_URL = 'http://localhost:3000';
    try {
      const { service, requests } = createHarness({ scopes: ['user:read:chat'] });

      await assert.rejects(
        service.getCurrent(7),
        (error: unknown) => {
          assert(error instanceof PredictionReauthRequiredError);
          assert.equal(error.reauthUrl, 'https://finalsrs.com/reauth');
          return true;
        },
      );
      assert.equal(requests.length, 0);
    } finally {
      if (previousBaseUrl === undefined) delete process.env.BASE_URL;
      else process.env.BASE_URL = previousBaseUrl;
    }
  });

  it('requires reauthorization when token ownership does not match the broadcaster', async () => {
    const { service } = createHarness({ validatedUserId: 'someone-else' });
    await assert.rejects(service.getCurrent(7), PredictionReauthRequiredError);
  });

  it('caches successful validation per token', async () => {
    const { service, validations } = createHarness({
      responses: [
        { data: { data: [] } },
        { data: { data: [] } },
      ],
    });

    await service.getCurrent(7);
    await service.getCurrent(7);
    assert.deepEqual(validations, ['token-one']);
  });

  it('selects the newest active or locked prediction from Twitch state', async () => {
    const current = prediction({ id: 'locked', status: 'LOCKED' });
    const { service } = createHarness({
      responses: [{
        data: {
          data: [
            prediction({ id: 'resolved', status: 'RESOLVED' }),
            current,
            prediction({ id: 'older-active' }),
          ],
        },
      }],
    });

    assert.deepEqual(await service.getCurrent(7), current);
  });

  it('creates a validated preset only when no current prediction exists', async () => {
    const created = prediction();
    const { service, requests } = createHarness({
      responses: [
        { data: { data: [] } },
        { data: { data: [created] } },
      ],
    });

    assert.deepEqual(await service.start(7, {
      id: 1,
      channelId: 7,
      alias: 'ranked',
      title: 'Will we win?',
      outcomes: ['Yes', 'No'],
      durationSeconds: 120,
    }), created);
    assert.equal(requests[1].method, 'POST');
    assert.deepEqual(requests[1].data, {
      broadcaster_id: 'broadcaster-1',
      title: 'Will we win?',
      outcomes: [{ title: 'Yes' }, { title: 'No' }],
      prediction_window: 120,
    });
  });

  it('refuses to create while an active prediction exists', async () => {
    const { service } = createHarness({
      responses: [{ data: { data: [prediction()] } }],
    });
    await assert.rejects(
      service.start(7, {
        id: 1,
        channelId: 7,
        alias: 'ranked',
        title: 'Will we win?',
        outcomes: ['Yes', 'No'],
        durationSeconds: 120,
      }),
      PredictionActiveConflictError,
    );
  });

  it('resolves by one-based number or case-insensitive exact outcome text', async () => {
    for (const selection of ['2', ' no ']) {
      const current = prediction();
      const resolved = prediction({ status: 'RESOLVED' });
      const { service, requests } = createHarness({
        responses: [
          { data: { data: [current] } },
          { data: { data: [resolved] } },
        ],
      });

      assert.deepEqual(await service.resolve(7, selection), resolved);
      assert.equal(requests[1].method, 'PATCH');
      assert.equal(requests[1].data.winning_outcome_id, 'no-id');
      assert.equal(requests[1].data.status, 'RESOLVED');
    }
  });

  it('returns numbered choices for an invalid outcome without patching', async () => {
    const { service, requests } = createHarness({
      responses: [{ data: { data: [prediction()] } }],
    });

    await assert.rejects(
      service.resolve(7, 'maybe'),
      (error: unknown) => {
        assert(error instanceof PredictionInvalidOutcomeError);
        assert.deepEqual(error.choices, ['1. Yes', '2. No']);
        return true;
      },
    );
    assert.equal(requests.length, 1);
  });

  it('cancels the current active or locked prediction', async () => {
    const canceled = prediction({ status: 'CANCELED' });
    const { service, requests } = createHarness({
      responses: [
        { data: { data: [prediction({ status: 'LOCKED' })] } },
        { data: { data: [canceled] } },
      ],
    });

    assert.deepEqual(await service.cancel(7), canceled);
    assert.equal(requests[1].data.status, 'CANCELED');
  });

  it('reports no active prediction when Twitch has no active or locked state', async () => {
    const { service } = createHarness({
      responses: [{ data: { data: [prediction({ status: 'RESOLVED' })] } }],
    });
    await assert.rejects(service.cancel(7), PredictionNoActiveError);
  });

  it('refreshes an expired token and retries once', async () => {
    const unauthorized: any = new Error('Unauthorized');
    unauthorized.response = { status: 401, data: { message: 'Invalid OAuth token' } };
    const { service, requests, validations } = createHarness({
      responses: [
        unauthorized,
        { data: { data: [] } },
      ],
    });

    assert.equal(await service.getCurrent(7), null);
    assert.equal(requests.length, 2);
    assert.deepEqual(validations, ['token-one', 'token-two']);
    assert.equal(requests[1].headers.Authorization, 'Bearer token-two');
  });

  it('maps eligibility and transient Twitch failures to stable errors', async () => {
    const unavailable: any = new Error('Unavailable');
    unavailable.response = { status: 400, data: { message: 'The broadcaster must be a partner or affiliate' } };
    const temporary: any = new Error('Rate limited');
    temporary.response = { status: 429, data: { message: 'Too Many Requests' } };

    await assert.rejects(
      createHarness({ responses: [unavailable] }).service.getCurrent(7),
      PredictionUnavailableError,
    );
    await assert.rejects(
      createHarness({ responses: [temporary] }).service.getCurrent(7),
      PredictionTemporaryError,
    );
  });

  describe('authorization status', () => {
    it('reports ready after validating authorization and probing prediction eligibility', async () => {
      const { service, requests } = createHarness();

      const status: PredictionAuthorizationStatus = await service.getAuthorizationStatus(7);

      assert.deepEqual(status, { state: 'ready' });
      assert.equal(requests.length, 1);
      assert.equal(requests[0].method, 'GET');
    });

    it('reports reauth_required for missing channel identity or token', async () => {
      const cases = [
        createHarness({ channel: null }),
        createHarness({
          channel: { id: 7, username: 'antiparty', twitch_user_id: null },
        }),
        createHarness({ accessToken: null }),
      ];

      for (const { service, requests } of cases) {
        assert.deepEqual(
          await service.getAuthorizationStatus(7),
          { state: 'reauth_required', reauthUrl: '/reauth' },
        );
        assert.equal(requests.length, 0);
      }
    });

    it('reports reauth_required for missing scope or token owner mismatch', async () => {
      for (const harness of [
        createHarness({ scopes: ['user:read:chat'] }),
        createHarness({ validatedUserId: 'someone-else' }),
      ]) {
        assert.deepEqual(
          await harness.service.getAuthorizationStatus(7),
          { state: 'reauth_required', reauthUrl: '/reauth' },
        );
        assert.equal(harness.requests.length, 0);
      }
    });

    it('reports reauth_required when expired authorization cannot be refreshed', async () => {
      const unauthorized: any = new Error('raw oauth failure with secret-token');
      unauthorized.response = {
        status: 401,
        data: { message: 'Invalid OAuth token secret-token' },
      };
      const { service } = createHarness({
        validationError: unauthorized,
        refreshedToken: null,
      });

      assert.deepEqual(
        await service.getAuthorizationStatus(7),
        { state: 'reauth_required', reauthUrl: '/reauth' },
      );
    });

    it('refreshes and retries validation HTTP 401 before requiring reauthorization', async () => {
      const unauthorized: any = new Error('raw unauthorized validation response');
      unauthorized.response = {
        status: 401,
        data: { message: 'Invalid OAuth token' },
      };
      const { service, validations } = createHarness({
        validationError: unauthorized,
      });

      assert.deepEqual(
        await service.getAuthorizationStatus(7),
        { state: 'reauth_required', reauthUrl: '/reauth' },
      );
      assert.deepEqual(validations, ['token-one', 'token-two']);
      await assert.rejects(service.getCurrent(7), PredictionReauthRequiredError);
    });

    it('reports unavailable with the standard Affiliate or Partner message', async () => {
      const unavailable: any = new Error('raw eligibility payload');
      unavailable.response = {
        status: 400,
        data: { message: 'The broadcaster must be a partner or affiliate' },
      };
      const { service } = createHarness({ responses: [unavailable] });

      assert.deepEqual(await service.getAuthorizationStatus(7), {
        state: 'unavailable',
        message: 'Channel Points Predictions require Twitch Affiliate or Partner status.',
      });
    });

    it('reports temporarily_unavailable for transient Twitch failures', async () => {
      for (const twitchStatus of [429, 500, 503]) {
        const failure: any = new Error(`raw failure ${twitchStatus}`);
        failure.response = {
          status: twitchStatus,
          data: { message: `raw Twitch payload ${twitchStatus}` },
        };
        const { service } = createHarness({ responses: [failure] });

        assert.deepEqual(
          await service.getAuthorizationStatus(7),
          { state: 'temporarily_unavailable' },
        );
      }
    });

    it('preserves temporary validation failures for status and prediction operations', async () => {
      const failures = [
        { name: 'rate limit', status: 429 },
        { name: 'server error', status: 500 },
        { name: 'network error' },
      ];

      for (const failureCase of failures) {
        const createFailure = () => {
          const error: any = new Error(
            failureCase.status
              ? `raw ${failureCase.name} secret-token`
              : 'raw OAuth validation network error secret-token',
          );
          if (failureCase.status) {
            error.response = {
              status: failureCase.status,
              data: { message: `raw Twitch ${failureCase.name} payload` },
            };
          }
          return error;
        };
        const statusHarness = createHarness({ validationError: createFailure() });
        assert.deepEqual(
          await statusHarness.service.getAuthorizationStatus(7),
          { state: 'temporarily_unavailable' },
          failureCase.name,
        );

        const operations = [
          (service: ReturnType<typeof createTwitchPredictionsService>) => service.getCurrent(7),
          (service: ReturnType<typeof createTwitchPredictionsService>) => service.start(7, {
            id: 1,
            channelId: 7,
            alias: 'ranked',
            title: 'Will we win?',
            outcomes: ['Yes', 'No'],
            durationSeconds: 120,
          }),
          (service: ReturnType<typeof createTwitchPredictionsService>) => service.resolve(7, '1'),
          (service: ReturnType<typeof createTwitchPredictionsService>) => service.cancel(7),
        ];
        for (const operation of operations) {
          const operationHarness = createHarness({ validationError: createFailure() });
          await assert.rejects(
            operation(operationHarness.service),
            (error: unknown) => {
              assert(error instanceof PredictionTemporaryError);
              assert.equal(error.message.includes('secret-token'), false);
              assert.equal(error.message.toLowerCase().includes('raw'), false);
              return true;
            },
            failureCase.name,
          );
        }
      }
    });

    it('never exposes tokens, raw Twitch payloads, or raw errors in status results', async () => {
      const secret = 'super-secret-access-token';
      const rawPayload = 'raw-private-twitch-payload';
      const failure: any = new Error(`raw-error-${secret}`);
      failure.response = {
        status: 500,
        data: { message: rawPayload },
      };
      const statuses: PredictionAuthorizationStatus[] = [];

      statuses.push(await createHarness({ accessToken: secret }).service.getAuthorizationStatus(7));
      statuses.push(await createHarness({ responses: [failure] }).service.getAuthorizationStatus(7));
      statuses.push(await createHarness({ accessToken: null }).service.getAuthorizationStatus(7));

      const serialized = JSON.stringify(statuses);
      assert.equal(serialized.includes(secret), false);
      assert.equal(serialized.includes(rawPayload), false);
      assert.equal(serialized.includes('raw-error'), false);
    });
  });
});
