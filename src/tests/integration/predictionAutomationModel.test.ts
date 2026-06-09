import { strict as assert } from 'assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { DataTypes, Sequelize } from 'sequelize';
import { initPredictionAutomationModels } from '@/models/predictionAutomation';
import { migratePredictionAutomation } from '@/scripts/migrate_prediction_automation';

describe('Prediction automation persistence', function () {
  this.timeout(15000);

  let tempDir: string;
  let sequelize: Sequelize;
  let models: ReturnType<typeof initPredictionAutomationModels>;
  let nextChannelId: number;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prediction-automation-'));
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: path.join(tempDir, 'automation.sqlite'),
      logging: false,
    });
    await sequelize.getQueryInterface().createTable('Channels', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      username: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
    });
    await migratePredictionAutomation(sequelize.getQueryInterface());
    models = initPredictionAutomationModels(sequelize);
    nextChannelId = 1;
  });

  afterEach(async () => {
    await sequelize.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function createChannel(username: string): Promise<number> {
    const id = nextChannelId++;
    await sequelize.getQueryInterface().bulkInsert(
      'Channels',
      [{ id, username }],
    );
    return id;
  }

  it('runs the migration twice without changing the schema', async () => {
    const queryInterface = sequelize.getQueryInterface();

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

  it('applies config defaults and enforces one config per channel', async () => {
    const channelId = await createChannel('automation-defaults');
    const config = await models.PredictionAutomationConfig.create({
      channel_id: channelId,
    });

    assert.equal(config.enabled, false);
    assert.equal(config.start_delay_minutes, 10);
    assert.equal(config.voting_window_seconds, 1800);
    assert.ok(config.created_at instanceof Date);
    assert.ok(config.updated_at instanceof Date);

    await assert.rejects(
      models.PredictionAutomationConfig.create({ channel_id: channelId }),
      /unique/i,
    );
  });

  it('updates updated_at when a config changes', async () => {
    const channelId = await createChannel('automation-timestamps');
    const config = await models.PredictionAutomationConfig.create({
      channel_id: channelId,
    });
    const originalUpdatedAt = config.updated_at.getTime();

    await new Promise((resolve) => setTimeout(resolve, 20));
    await config.update({ enabled: true });

    assert.ok(config.updated_at.getTime() > originalUpdatedAt);
  });

  it('validates delay and voting window bounds at model level', async () => {
    const channelId = await createChannel('automation-validation');

    for (const startDelay of [0, 61]) {
      await assert.rejects(
        models.PredictionAutomationConfig.create({
          channel_id: channelId,
          start_delay_minutes: startDelay,
        }),
        /validation/i,
      );
    }

    for (const votingWindow of [29, 1801]) {
      await assert.rejects(
        models.PredictionAutomationConfig.create({
          channel_id: channelId,
          voting_window_seconds: votingWindow,
        }),
        /validation/i,
      );
    }
  });

  it('creates a run, permits nullable lifecycle fields, and rejects duplicate streams', async () => {
    const channelId = await createChannel('automation-runs');
    const streamStartedAt = new Date('2026-06-08T12:00:00.000Z');
    const values = {
      channel_id: channelId,
      stream_started_at: streamStartedAt,
      session_start_score: 45000,
      status: 'scheduled' as const,
    };
    const run = await models.PredictionAutomationRun.create(values);

    assert.equal(run.prediction_id, null);
    assert.equal(run.outcomes_json, null);
    assert.equal(run.offline_detected_at, null);
    assert.equal(run.resolution_deadline_at, null);
    assert.equal(run.last_resolution_attempt_at, null);
    assert.equal(run.terminal_reason, null);

    await assert.rejects(
      models.PredictionAutomationRun.create(values),
      /unique/i,
    );
  });

  it('rejects invalid run statuses at the database boundary', async () => {
    const channelId = await createChannel('automation-status-check');

    await assert.rejects(
      sequelize.query(
        `INSERT INTO PredictionAutomationRuns
          (channel_id, stream_started_at, session_start_score, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        {
          replacements: [
            channelId,
            '2026-06-08 12:00:00.000 +00:00',
            45000,
            'invalid',
            '2026-06-08 12:00:00.000 +00:00',
            '2026-06-08 12:00:00.000 +00:00',
          ],
        },
      ),
      (error: unknown) => {
        const databaseMessage = (error as {
          parent?: { message?: string };
        }).parent?.message;
        return /check constraint failed/i.test(databaseMessage ?? '');
      },
    );
  });
});

describe('Prediction automation partial migration repair', function () {
  this.timeout(15000);

  let tempDir: string;
  let sequelize: Sequelize;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prediction-automation-partial-'));
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: path.join(tempDir, 'partial.sqlite'),
      logging: false,
    });
    const queryInterface = sequelize.getQueryInterface();
    await queryInterface.createTable('Channels', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
    });
    await queryInterface.createTable('PredictionAutomationConfigs', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      channel_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      start_delay_minutes: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 10,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });
    await queryInterface.createTable('PredictionAutomationRuns', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      channel_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      stream_started_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      session_start_score: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });
    await queryInterface.bulkInsert('Channels', [{ id: 1 }]);
    await queryInterface.bulkInsert('PredictionAutomationConfigs', [{
      channel_id: 1,
      enabled: false,
      start_delay_minutes: 10,
      created_at: new Date(),
      updated_at: new Date(),
    }]);
    await queryInterface.bulkInsert('PredictionAutomationRuns', [{
      channel_id: 1,
      stream_started_at: new Date('2026-06-08T12:00:00.000Z'),
      session_start_score: 45000,
      status: 'scheduled',
      created_at: new Date(),
      updated_at: new Date(),
    }]);
  });

  afterEach(async () => {
    await sequelize.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('adds missing columns and indexes without replacing existing rows', async () => {
    const queryInterface = sequelize.getQueryInterface();

    await migratePredictionAutomation(queryInterface);

    const configTable = await queryInterface.describeTable('PredictionAutomationConfigs');
    const runTable = await queryInterface.describeTable('PredictionAutomationRuns');
    const configRows = await sequelize.query(
      'SELECT id, channel_id FROM PredictionAutomationConfigs',
      { type: 'SELECT' },
    ) as Array<{ id: number; channel_id: number }>;
    const runRows = await sequelize.query(
      'SELECT id, channel_id, status FROM PredictionAutomationRuns',
      { type: 'SELECT' },
    ) as Array<{ id: number; channel_id: number; status: string }>;

    assert.ok(configTable.voting_window_seconds);
    assert.ok(runTable.prediction_id);
    assert.ok(runTable.outcomes_json);
    assert.ok(runTable.offline_detected_at);
    assert.ok(runTable.resolution_deadline_at);
    assert.ok(runTable.last_resolution_attempt_at);
    assert.ok(runTable.terminal_reason);
    assert.deepEqual(configRows, [{ id: 1, channel_id: 1 }]);
    assert.deepEqual(runRows, [{ id: 1, channel_id: 1, status: 'scheduled' }]);
  });
});

describe('Prediction automation sync-before-migration repair', function () {
  this.timeout(15000);

  let tempDir: string;
  let sequelize: Sequelize;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prediction-automation-sync-'));
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: path.join(tempDir, 'sync-order.sqlite'),
      logging: false,
    });
    const queryInterface = sequelize.getQueryInterface();
    await queryInterface.createTable('Channels', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
    });
    await queryInterface.createTable('PredictionAutomationConfigs', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    });
    await queryInterface.createTable('PredictionAutomationRuns', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      channel_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      stream_started_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      session_start_score: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    });
    initPredictionAutomationModels(sequelize);
  });

  afterEach(async () => {
    await sequelize.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('survives sync before migration and repairs missing indexed columns and indexes', async () => {
    await sequelize.sync();
    await migratePredictionAutomation(sequelize.getQueryInterface());

    const queryInterface = sequelize.getQueryInterface();
    const configTable = await queryInterface.describeTable('PredictionAutomationConfigs');
    const runTable = await queryInterface.describeTable('PredictionAutomationRuns');
    const configIndexes = await queryInterface.showIndex(
      'PredictionAutomationConfigs',
    ) as unknown as Array<{ name: string }>;
    const runIndexes = await queryInterface.showIndex(
      'PredictionAutomationRuns',
    ) as unknown as Array<{ name: string }>;

    assert.ok(configTable.channel_id);
    assert.ok(runTable.status);
    assert.ok(configIndexes.some((index) => index.name === 'prediction_automation_configs_channel_unique'));
    assert.ok(runIndexes.some((index) => index.name === 'prediction_automation_runs_channel_stream_unique'));
    assert.ok(runIndexes.some((index) => index.name === 'prediction_automation_runs_status'));
    assert.ok(runIndexes.some((index) => index.name === 'prediction_automation_runs_channel_id'));
  });
});
