import { strict as assert } from 'assert';
import {
  createRankedPredictionAutomationService,
} from '@/services/rankedPredictionAutomation.service';
import { DEFAULT_PREDICTION_AUTOMATION_CONFIG } from '@/models/predictionAutomation';

function harness(options: {
  now?: number;
  startRs?: number | null;
  finalRs?: number | null;
  currentPrediction?: any;
  validateContent?: () => Promise<void>;
  hasAccess?: boolean;
} = {}) {
  const runs: any[] = [];
  const started: any[] = [];
  const resolved: any[] = [];
  const canceled: any[] = [];
  const config = { ...DEFAULT_PREDICTION_AUTOMATION_CONFIG, enabled: true };
  const channel = {
    id: 7,
    username: 'antiparty',
    player_id: 'Player#1234',
    session_start_rs: options.startRs === undefined ? 50000 : options.startRs,
    has_subscription: options.hasAccess === undefined ? true : options.hasAccess,
    role: 'Basic user',
  };
  let now = options.now ?? Date.parse('2026-06-11T12:11:00Z');

  const service = createRankedPredictionAutomationService({
    now: () => now,
    loadChannel: async () => channel,
    loadConfig: async () => config,
    saveConfig: async (_channelId, saved) => saved,
    findRun: async (_channelId, streamId) => (
      runs.find((run) => run.twitch_stream_id === streamId) || null
    ),
    findCurrentRun: async () => runs[runs.length - 1] || null,
    createRun: async (values) => {
      const run: any = { id: runs.length + 1, ...values };
      runs.push(run);
      return run;
    },
    updateRun: async (run, values) => Object.assign(run, values),
    getCurrentScore: async () => (
      options.finalRs === undefined ? 51000 : options.finalRs
    ),
    predictions: {
      getAuthorizationStatus: async () => ({ state: 'ready' as const }),
      getCurrent: async () => options.currentPrediction || null,
      getById: async () => null,
      start: async (_channelId, preset) => {
        started.push(preset);
        return {
          id: 'prediction-1',
          title: preset.title,
          status: 'ACTIVE',
          outcomes: preset.outcomes.map((title: string, index: number) => ({
            id: `outcome-${index + 1}`,
            title,
          })),
        };
      },
      resolveById: async (_channelId, predictionId, outcomeId) => {
        resolved.push({ predictionId, outcomeId });
        return { id: predictionId, status: 'RESOLVED', title: '', outcomes: [] };
      },
      cancelById: async (_channelId, predictionId) => {
        canceled.push(predictionId);
        return { id: predictionId, status: 'CANCELED', title: '', outcomes: [] };
      },
    },
    validateContent: options.validateContent || (async () => undefined),
  });

  return {
    service,
    runs,
    started,
    resolved,
    canceled,
    setNow: (value: number) => { now = value; },
  };
}

const liveStream = {
  id: 'stream-1',
  username: 'antiparty',
  gameName: 'THE FINALS',
  startedAt: '2026-06-11T12:00:00Z',
};

describe('Ranked prediction automation service', () => {
  it('creates once after the delay and persists exact Twitch IDs', async () => {
    const { service, runs, started } = harness();

    const first = await service.evaluateStream(7, liveStream);
    const second = await service.evaluateStream(7, liveStream);

    assert.equal(first.status, 'voting');
    assert.equal(second.id, first.id);
    assert.equal(started.length, 1);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].twitch_prediction_id, 'prediction-1');
    const stored = JSON.parse(runs[0].twitch_outcome_ids_json);
    assert.equal(stored[3].id, 'outcome-4');
    assert.equal(stored[3].minDelta, 1000);
  });

  it('manual start bypasses only the delay', async () => {
    const { service, started } = harness({
      now: Date.parse('2026-06-11T12:01:00Z'),
    });

    const scheduled = await service.evaluateStream(7, liveStream);
    assert.equal(scheduled.status, 'scheduled');
    assert.equal(started.length, 0);

    const forced = await service.evaluateStream(7, liveStream, { bypassDelay: true });
    assert.equal(forced.status, 'voting');
    assert.equal(started.length, 1);
  });

  it('does not replace an existing manual prediction', async () => {
    const { service, started } = harness({
      currentPrediction: { id: 'manual', status: 'ACTIVE', outcomes: [] },
    });

    const run = await service.evaluateStream(7, liveStream);
    assert.equal(run.status, 'scheduled');
    assert.equal(started.length, 0);
  });

  it('flags an uncertain create instead of adopting or replacing another prediction', async () => {
    const state = harness({
      currentPrediction: { id: 'unknown-active', status: 'ACTIVE', outcomes: [] },
    });
    state.runs.push({
      id: 1,
      broadcaster_id: 7,
      twitch_stream_id: 'stream-1',
      status: 'creating',
    });

    const run = await state.service.evaluateStream(7, liveStream);

    assert.equal(run.status, 'needs_attention');
    assert.equal(run.failure_reason, 'prediction_creation_uncertain');
    assert.equal(state.started.length, 0);
  });

  it('moves voting to tracking after the configured voting window', async () => {
    const state = harness();
    await state.service.evaluateStream(7, liveStream);
    state.setNow(Date.parse('2026-06-11T12:22:00Z'));

    const status = await state.service.getStatus(7, liveStream);

    assert.equal(status.run?.status, 'tracking');
    assert.equal(status.startingRs, 50000);
    assert.equal(status.latestRs, 51000);
    assert.equal(status.delta, 1000);
  });

  it('resolves the exact stored prediction from the final RS delta', async () => {
    const { service, resolved, canceled } = harness({ finalRs: 51000 });
    await service.evaluateStream(7, liveStream);

    const run = await service.finalizeStream(7, 'stream-1');

    assert.equal(run?.status, 'resolved');
    assert.deepEqual(resolved, [{
      predictionId: 'prediction-1',
      outcomeId: 'outcome-4',
    }]);
    assert.deepEqual(canceled, []);
  });

  it('cancels and refunds when baseline or final RS is unavailable', async () => {
    for (const options of [{ startRs: null }, { finalRs: null }]) {
      const { service, canceled, resolved } = harness(options);
      const run = await service.evaluateStream(7, liveStream, { bypassDelay: true });
      if (run.status === 'voting') {
        const final = await service.finalizeStream(7, 'stream-1');
        assert.equal(final?.status, 'canceled');
        assert.deepEqual(canceled, ['prediction-1']);
        assert.deepEqual(resolved, []);
      } else {
        assert.equal(run.status, 'waiting_for_start_rs');
      }
    }
  });

  it('validates blocked content before saving configuration', async () => {
    const state = harness({
      validateContent: async () => {
        throw new Error('blocked content');
      },
    });

    await assert.rejects(
      state.service.saveConfig(7, {
        ...DEFAULT_PREDICTION_AUTOMATION_CONFIG,
        enabled: true,
      }),
      /blocked content/,
    );
  });

  it('does not start automation after subscriber or tester access expires', async () => {
    const state = harness({ hasAccess: false });

    const run = await state.service.evaluateStream(7, liveStream);

    assert.equal(run.status, 'needs_attention');
    assert.equal(run.failure_reason, 'subscription_required');
    assert.equal(state.started.length, 0);
  });
});
