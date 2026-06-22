import { strict as assert } from 'assert';
import {
  createRankedPredictionAutomationService,
} from '@/services/rankedPredictionAutomation.service';
import { DEFAULT_PREDICTION_AUTOMATION_CONFIG } from '@/models/predictionAutomation';

function harness(options: {
  now?: number;
  startRs?: number | null;
  finalRs?: number | null;
  config?: Partial<typeof DEFAULT_PREDICTION_AUTOMATION_CONFIG>;
  currentPrediction?: any;
  predictionById?: any;
  getById?: () => Promise<any>;
  random?: () => number;
  validateContent?: () => Promise<void>;
  hasAccess?: boolean;
} = {}) {
  const runs: any[] = [];
  const started: any[] = [];
  const resolved: any[] = [];
  const canceled: any[] = [];
  const announcements: string[] = [];
  const config = {
    ...DEFAULT_PREDICTION_AUTOMATION_CONFIG,
    enabled: true,
    ...options.config,
  };
  const channel = {
    id: 7,
    username: 'antiparty',
    player_id: 'Player#1234',
    session_start_rs: options.startRs === undefined ? 50000 : options.startRs,
    has_subscription: options.hasAccess === undefined ? true : options.hasAccess,
    role: 'Basic user',
  };
  let now = options.now ?? Date.parse('2026-06-11T12:11:00Z');
  let currentScore = options.finalRs === undefined ? 51000 : options.finalRs;

  const service = createRankedPredictionAutomationService({
    now: () => now,
    random: options.random || (() => 0),
    countEmptyRetries: async (_channelId, streamId) => runs.filter(
      (run) => run.twitch_stream_id === streamId && run.failure_reason === 'no_votes',
    ).length,
    loadChannel: async () => channel,
    loadConfig: async () => config,
    saveConfig: async (_channelId, saved) => saved,
    findRun: async (_channelId, streamId) => (
      [...runs].reverse().find((run) => run.twitch_stream_id === streamId) || null
    ),
    findCurrentRun: async () => runs[runs.length - 1] || null,
    createRun: async (values) => {
      if (runs.some((run) => (
        run.twitch_stream_id === values.twitch_stream_id
        && Number(run.cycle_index || 1) === Number(values.cycle_index || 1)
      ))) {
        throw new Error('unique constraint');
      }
      const run: any = { id: runs.length + 1, ...values };
      runs.push(run);
      return run;
    },
    updateRun: async (run, values) => Object.assign(run, values),
    claimRun: async (run) => {
      if (run.status === 'creating') return false;
      run.status = 'creating';
      return true;
    },
    getCurrentScore: async () => currentScore,
    announce: async (_channel, message) => {
      announcements.push(message);
    },
    predictions: {
      getAuthorizationStatus: async () => ({ state: 'ready' as const }),
      getCurrent: async () => options.currentPrediction || null,
      getById: options.getById || (async () => options.predictionById || null),
      start: async (_channelId, preset) => {
        started.push(preset);
        const predictionNumber = started.length;
        return {
          id: `prediction-${predictionNumber}`,
          title: preset.title,
          status: 'ACTIVE',
          outcomes: preset.outcomes.map((title: string, index: number) => ({
            id: `prediction-${predictionNumber}-outcome-${index + 1}`,
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
    announcements,
    setNow: (value: number) => { now = value; },
    setCurrentScore: (value: number | null) => { currentScore = value; },
    setEnabled: (value: boolean) => { config.enabled = value; },
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
    assert.equal(stored[3].id, 'prediction-1-outcome-4');
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
      outcomeId: 'prediction-1-outcome-4',
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

  it('repeats next-result predictions after resolving a confirmed RS movement and cooldown', async () => {
    const state = harness({
      finalRs: 50000,
      config: {
        mode: 'next_result',
        startDelaySeconds: 300,
        votingWindowSeconds: 30,
        question: 'Will the next ranked result gain or lose RS?',
        outcomes: [
          { label: 'Lose RS', minDelta: null, maxDelta: -1 },
          { label: 'Gain RS', minDelta: 1, maxDelta: null },
        ],
      },
      now: Date.parse('2026-06-11T12:06:00Z'),
    });

    const first = await state.service.evaluateStream(7, liveStream);
    assert.equal(first.status, 'voting');
    assert.equal(first.cycle_index, 1);
    assert.equal(first.baseline_rs, 50000);
    assert.equal(state.announcements.length, 1);
    assert.match(state.announcements[0], /Vote now/i);

    state.setNow(Date.parse('2026-06-11T12:06:31Z'));
    const tracking = await state.service.evaluateStream(7, liveStream);
    assert.equal(tracking.status, 'tracking');
    assert.equal(state.resolved.length, 0);

    state.setCurrentScore(50125);
    const resolved = await state.service.evaluateStream(7, liveStream);
    assert.equal(resolved.status, 'resolved');
    assert.deepEqual(state.resolved, [{
      predictionId: 'prediction-1',
      outcomeId: 'prediction-1-outcome-2',
    }]);

    state.setNow(Date.parse('2026-06-11T12:08:30Z'));
    const coolingDown = await state.service.evaluateStream(7, liveStream);
    assert.equal(coolingDown.id, first.id);
    assert.equal(state.started.length, 1);

    state.setNow(Date.parse('2026-06-11T12:08:32Z'));
    const second = await state.service.evaluateStream(7, liveStream);
    assert.equal(second.status, 'voting');
    assert.equal(second.cycle_index, 2);
    assert.equal(second.baseline_rs, 50125);
    assert.equal(state.started.length, 2);
    assert.equal(state.announcements.length, 2);
  });

  it('refunds a stale next-result prediction and waits for RS movement before another cycle', async () => {
    const state = harness({
      finalRs: 50000,
      config: {
        mode: 'next_result',
        startDelaySeconds: 300,
        votingWindowSeconds: 30,
        question: 'Will the next ranked result gain or lose RS?',
        outcomes: [
          { label: 'Lose RS', minDelta: null, maxDelta: -1 },
          { label: 'Gain RS', minDelta: 1, maxDelta: null },
        ],
      },
      now: Date.parse('2026-06-11T12:06:00Z'),
    });

    const first = await state.service.evaluateStream(7, liveStream);
    state.setNow(Date.parse('2026-06-11T12:36:31Z'));
    const timedOut = await state.service.evaluateStream(7, liveStream);

    assert.equal(timedOut.status, 'canceled');
    assert.equal(timedOut.failure_reason, 'score_change_timeout');
    assert.deepEqual(state.canceled, ['prediction-1']);

    state.setNow(Date.parse('2026-06-11T12:40:00Z'));
    const stillStale = await state.service.evaluateStream(7, liveStream);
    assert.equal(stillStale.id, first.id);
    assert.equal(state.started.length, 1);

    state.setCurrentScore(49950);
    const moved = await state.service.evaluateStream(7, liveStream);
    assert.equal(moved.cycle_index, 2);
    assert.equal(moved.baseline_rs, 49950);
    assert.equal(state.started.length, 2);
  });

  it('finishes an active next-result prediction after disabling but does not repeat it', async () => {
    const state = harness({
      finalRs: 50000,
      config: {
        mode: 'next_result',
        startDelaySeconds: 300,
        votingWindowSeconds: 30,
        question: 'Will the next ranked result gain or lose RS?',
        outcomes: [
          { label: 'Lose RS', minDelta: null, maxDelta: -1 },
          { label: 'Gain RS', minDelta: 1, maxDelta: null },
        ],
      },
      now: Date.parse('2026-06-11T12:06:00Z'),
    });

    await state.service.evaluateStream(7, liveStream);
    state.setEnabled(false);
    state.setNow(Date.parse('2026-06-11T12:06:31Z'));
    state.setCurrentScore(49900);

    const resolved = await state.service.evaluateStream(7, liveStream);
    assert.equal(resolved.status, 'resolved');
    assert.deepEqual(state.resolved, [{
      predictionId: 'prediction-1',
      outcomeId: 'prediction-1-outcome-1',
    }]);

    state.setNow(Date.parse('2026-06-11T12:10:00Z'));
    const disabled = await state.service.evaluateStream(7, liveStream);
    assert.equal(disabled.status, 'skipped');
    assert.equal(state.started.length, 1);
  });

  it('reconciles a next-result prediction canceled directly on Twitch', async () => {
    const state = harness({
      finalRs: 50000,
      predictionById: { id: 'prediction-1', status: 'CANCELED', outcomes: [] },
      config: {
        mode: 'next_result',
        startDelaySeconds: 300,
        votingWindowSeconds: 30,
        question: 'Will the next ranked result gain or lose RS?',
        outcomes: [
          { label: 'Lose RS', minDelta: null, maxDelta: -1 },
          { label: 'Gain RS', minDelta: 1, maxDelta: null },
        ],
      },
      now: Date.parse('2026-06-11T12:06:00Z'),
    });

    await state.service.evaluateStream(7, liveStream);
    state.setNow(Date.parse('2026-06-11T12:06:10Z'));
    const reconciled = await state.service.evaluateStream(7, liveStream);

    assert.equal(reconciled.status, 'canceled');
    assert.equal(reconciled.failure_reason, 'canceled_on_twitch');
    assert.deepEqual(state.canceled, []);
    assert.deepEqual(state.resolved, []);
  });

  it('allows only one Twitch create when two evaluators start the same cycle', async () => {
    const state = harness();

    const [first, second] = await Promise.all([
      state.service.evaluateStream(7, liveStream),
      state.service.evaluateStream(7, liveStream),
    ]);

    assert.equal(state.started.length, 1);
    assert.equal(first.id, second.id);
  });

  function lockedPrediction(votes: number) {
    return {
      id: 'prediction-1',
      status: 'LOCKED',
      title: '',
      outcomes: [
        { id: 'o1', title: 'a', users: votes, channel_points: votes * 10 },
        { id: 'o2', title: 'b', users: 0, channel_points: 0 },
      ],
    };
  }

  it('cancels an empty prediction at lock and re-opens after the cooldown', async () => {
    const state = harness({ predictionById: lockedPrediction(0) });

    const voting = await state.service.evaluateStream(7, liveStream);
    assert.equal(voting.status, 'voting');
    assert.equal(state.started.length, 1);

    // After the 10-minute voting window, the prediction locks with no votes.
    state.setNow(Date.parse('2026-06-11T12:21:01Z'));
    const empty = await state.service.evaluateStream(7, liveStream);
    assert.equal(empty.status, 'canceled');
    assert.equal(empty.failure_reason, 'no_votes');
    assert.deepEqual(state.canceled, ['prediction-1']);
    assert.equal(state.started.length, 1);

    // Still within the cooldown — no new prediction yet.
    state.setNow(Date.parse('2026-06-11T12:25:00Z'));
    const cooling = await state.service.evaluateStream(7, liveStream);
    assert.equal(cooling.status, 'canceled');
    assert.equal(state.started.length, 1);

    // Cooldown elapsed (10 min with random()=0) — a fresh cycle opens.
    state.setNow(Date.parse('2026-06-11T12:31:02Z'));
    const retry = await state.service.evaluateStream(7, liveStream);
    assert.equal(retry.status, 'voting');
    assert.equal(retry.cycle_index, 2);
    assert.equal(state.started.length, 2);
  });

  it('locks in to tracking when the prediction has votes', async () => {
    const state = harness({ predictionById: lockedPrediction(7) });

    await state.service.evaluateStream(7, liveStream);
    state.setNow(Date.parse('2026-06-11T12:21:01Z'));
    const tracking = await state.service.evaluateStream(7, liveStream);

    assert.equal(tracking.status, 'tracking');
    assert.deepEqual(state.canceled, []);
  });

  it('does not cancel when the lock check cannot read the prediction', async () => {
    const state = harness({
      getById: async () => { throw new Error('twitch unavailable'); },
    });

    await state.service.evaluateStream(7, liveStream);
    state.setNow(Date.parse('2026-06-11T12:21:01Z'));
    const stillVoting = await state.service.evaluateStream(7, liveStream);

    assert.equal(stillVoting.status, 'voting');
    assert.deepEqual(state.canceled, []);
  });

  it('waits while the prediction is still active on Twitch', async () => {
    const state = harness({
      predictionById: { id: 'prediction-1', status: 'ACTIVE', title: '', outcomes: [] },
    });

    await state.service.evaluateStream(7, liveStream);
    state.setNow(Date.parse('2026-06-11T12:21:01Z'));
    const stillVoting = await state.service.evaluateStream(7, liveStream);

    assert.equal(stillVoting.status, 'voting');
    assert.deepEqual(state.canceled, []);
  });

  it('stops re-opening empty predictions after three attempts', async () => {
    const state = harness({ predictionById: lockedPrediction(0) });
    const base = Date.parse('2026-06-11T12:11:00Z');
    const minute = 60 * 1000;

    let cursor = base;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      state.setNow(cursor);
      const voting = await state.service.evaluateStream(7, liveStream);
      assert.equal(voting.status, 'voting', `attempt ${attempt} should open`);
      assert.equal(state.started.length, attempt);

      // Lock with no votes 10 minutes later → cancel + 10 minute cooldown.
      cursor += 10 * minute + minute;
      state.setNow(cursor);
      const canceled = await state.service.evaluateStream(7, liveStream);
      assert.equal(canceled.failure_reason, 'no_votes', `attempt ${attempt} should cancel`);

      cursor += 10 * minute + minute; // past the retry cooldown
    }

    // Cap reached: the fourth attempt must not open another prediction.
    state.setNow(cursor);
    const parked = await state.service.evaluateStream(7, liveStream);
    assert.equal(parked.status, 'canceled');
    assert.equal(state.started.length, 3);
  });
});
