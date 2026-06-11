import { strict as assert } from 'assert';
import {
  Channel,
  PredictionAutomationConfig,
  PredictionAutomationRun,
  dbReady,
} from '@/db';

describe('Prediction automation models', () => {
  before(async () => {
    await dbReady;
  });

  afterEach(async () => {
    await PredictionAutomationRun.destroy({ where: {}, truncate: true });
    await PredictionAutomationConfig.destroy({ where: {}, truncate: true });
    await Channel.destroy({ where: { username: 'automation-model-test' } });
  });

  it('persists one configuration and distinct prediction cycles per Twitch stream', async () => {
    const channel = await Channel.create({
      username: 'automation-model-test',
      twitch_user_id: '991',
    });
    const config = await PredictionAutomationConfig.create({
      broadcaster_id: channel.id,
      enabled: true,
      mode: 'next_result',
      start_delay_seconds: 600,
      voting_window_seconds: 600,
      question: 'How much RS will I gain?',
      outcomes_json: JSON.stringify([
        { label: 'Down', minDelta: null, maxDelta: -1 },
        { label: 'Up', minDelta: 0, maxDelta: null },
      ]),
    });
    const run = await PredictionAutomationRun.create({
      broadcaster_id: channel.id,
      twitch_stream_id: 'stream-123',
      mode: 'next_result',
      cycle_index: 1,
      status: 'scheduled',
      baseline_rs: 50000,
    });
    const secondRun = await PredictionAutomationRun.create({
      broadcaster_id: channel.id,
      twitch_stream_id: 'stream-123',
      mode: 'next_result',
      cycle_index: 2,
      status: 'scheduled',
      baseline_rs: 50100,
    });

    assert.equal(config.enabled, true);
    assert.equal(config.mode, 'next_result');
    assert.equal(run.twitch_stream_id, 'stream-123');
    assert.equal(secondRun.cycle_index, 2);
    assert.equal(secondRun.baseline_rs, 50100);

    await assert.rejects(
      PredictionAutomationRun.create({
        broadcaster_id: channel.id,
        twitch_stream_id: 'stream-123',
        mode: 'next_result',
        cycle_index: 2,
        status: 'scheduled',
      }),
      /unique/i,
    );
  });
});
