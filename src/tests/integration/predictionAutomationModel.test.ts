import { strict as assert } from 'assert';
import {
  Channel,
  CustomResponse,
  PredictionAutomationConfig,
  PredictionAutomationRun,
  dbReady,
  sequelize,
} from '@/db';
import { migratePredictionAutomation } from '@/scripts/migrate_prediction_automation';

describe('Prediction automation models', function () {
  this.timeout(15000);

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const usernames = [
    `prediction-automation-a-${suffix}`,
    `prediction-automation-b-${suffix}`,
  ];
  const createdChannelIds: number[] = [];

  before(async () => {
    await dbReady;
  });

  after(async () => {
    if (createdChannelIds.length > 0) {
      await PredictionAutomationRun.destroy({
        where: { channel_id: createdChannelIds },
      });
      await PredictionAutomationConfig.destroy({
        where: { channel_id: createdChannelIds },
      });
    }
    await Channel.destroy({ where: { username: usernames } });
    await CustomResponse.destroy({ where: { channel: usernames } });

    const remainingOwnedResponses = await CustomResponse.count({
      where: { channel: usernames },
    });
    assert.equal(remainingOwnedResponses, 0);
  });

  async function createChannel(username: string) {
    const channel = await Channel.create({ username });
    createdChannelIds.push(channel.id);
    return channel;
  }

  it('runs the prediction automation migration twice without changing the schema', async () => {
    const queryInterface = sequelize.getQueryInterface();

    await migratePredictionAutomation(queryInterface);
    await migratePredictionAutomation(queryInterface);

    const configTable = await queryInterface.describeTable('PredictionAutomationConfigs');
    const runTable = await queryInterface.describeTable('PredictionAutomationRuns');
    const configIndexes = await queryInterface.showIndex(
      'PredictionAutomationConfigs',
    ) as unknown as Array<{ name: string }>;
    const runIndexes = await queryInterface.showIndex(
      'PredictionAutomationRuns',
    ) as unknown as Array<{ name: string }>;

    assert.ok(configTable.channel_id);
    assert.ok(runTable.stream_started_at);
    assert.ok(configIndexes.some((index) => index.name === 'prediction_automation_configs_channel_unique'));
    assert.ok(runIndexes.some((index) => index.name === 'prediction_automation_runs_channel_stream_unique'));
    assert.ok(runIndexes.some((index) => index.name === 'prediction_automation_runs_status'));
    assert.ok(runIndexes.some((index) => index.name === 'prediction_automation_runs_channel_id'));
  });

  it('applies prediction automation config defaults', async () => {
    const channel = await createChannel(usernames[0]);
    const config = await PredictionAutomationConfig.create({
      channel_id: channel.id,
    });

    assert.equal(config.enabled, false);
    assert.equal(config.start_delay_minutes, 10);
    assert.equal(config.voting_window_seconds, 1800);
    assert.ok(config.created_at instanceof Date);
    assert.ok(config.updated_at instanceof Date);
  });

  it('allows only one automation config per channel', async () => {
    const channel = await Channel.findOne({ where: { username: usernames[0] } });
    assert.ok(channel);

    await assert.rejects(
      PredictionAutomationConfig.create({ channel_id: channel.id }),
      /unique/i,
    );
  });

  it('creates a scheduled automation run with nullable lifecycle fields', async () => {
    const channel = await Channel.findOne({ where: { username: usernames[0] } });
    assert.ok(channel);

    const run = await PredictionAutomationRun.create({
      channel_id: channel.id,
      stream_started_at: new Date('2026-06-08T12:00:00.000Z'),
      session_start_score: 45000,
      status: 'scheduled',
    });

    assert.equal(run.status, 'scheduled');
    assert.equal(run.session_start_score, 45000);
    assert.equal(run.prediction_id, null);
    assert.equal(run.outcomes_json, null);
    assert.equal(run.offline_detected_at, null);
    assert.equal(run.resolution_deadline_at, null);
    assert.equal(run.last_resolution_attempt_at, null);
    assert.equal(run.terminal_reason, null);
    assert.ok(run.created_at instanceof Date);
    assert.ok(run.updated_at instanceof Date);
  });

  it('rejects duplicate runs for the same channel and stream start', async () => {
    const channel = await Channel.findOne({ where: { username: usernames[0] } });
    assert.ok(channel);
    const streamStartedAt = new Date('2026-06-08T13:00:00.000Z');
    const values = {
      channel_id: channel.id,
      stream_started_at: streamStartedAt,
      session_start_score: 45100,
      status: 'scheduled' as const,
    };

    await PredictionAutomationRun.create(values);
    await assert.rejects(PredictionAutomationRun.create(values), /unique/i);

    const secondChannel = await createChannel(usernames[1]);
    const otherRun = await PredictionAutomationRun.create({
      ...values,
      channel_id: secondChannel.id,
    });
    assert.equal(otherRun.channel_id, secondChannel.id);
  });
});
