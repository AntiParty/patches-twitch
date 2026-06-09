import { DataTypes, QueryInterface } from 'sequelize';
import logger from '@/util/logger';

async function ensureIndex(
  queryInterface: QueryInterface,
  tableName: string,
  fields: string[],
  name: string,
  unique = false,
): Promise<void> {
  const indexes = await queryInterface.showIndex(tableName) as unknown as Array<{
    name: string;
  }>;
  if (indexes.some((index) => index.name === name)) return;

  await queryInterface.addIndex(tableName, fields, { name, unique });
}

export async function migratePredictionAutomation(
  queryInterface: QueryInterface,
): Promise<void> {
  const configTable = await queryInterface
    .describeTable('PredictionAutomationConfigs')
    .catch(() => null);

  if (!configTable) {
    logger.info('[Migration] Creating PredictionAutomationConfigs table...');
    await queryInterface.createTable('PredictionAutomationConfigs', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      channel_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'Channels',
          key: 'id',
        },
        onDelete: 'CASCADE',
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
      voting_window_seconds: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1800,
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
  }

  await ensureIndex(
    queryInterface,
    'PredictionAutomationConfigs',
    ['channel_id'],
    'prediction_automation_configs_channel_unique',
    true,
  );

  const runTable = await queryInterface
    .describeTable('PredictionAutomationRuns')
    .catch(() => null);

  if (!runTable) {
    logger.info('[Migration] Creating PredictionAutomationRuns table...');
    await queryInterface.createTable('PredictionAutomationRuns', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      channel_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'Channels',
          key: 'id',
        },
        onDelete: 'CASCADE',
      },
      stream_started_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      session_start_score: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      prediction_id: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
      },
      outcomes_json: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null,
      },
      status: {
        type: DataTypes.ENUM(
          'scheduled',
          'active',
          'resolving',
          'resolved',
          'canceled',
          'skipped',
        ),
        allowNull: false,
      },
      offline_detected_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
      },
      resolution_deadline_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
      },
      last_resolution_attempt_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
      },
      terminal_reason: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null,
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
  }

  await ensureIndex(
    queryInterface,
    'PredictionAutomationRuns',
    ['channel_id', 'stream_started_at'],
    'prediction_automation_runs_channel_stream_unique',
    true,
  );
  await ensureIndex(
    queryInterface,
    'PredictionAutomationRuns',
    ['status'],
    'prediction_automation_runs_status',
  );
  await ensureIndex(
    queryInterface,
    'PredictionAutomationRuns',
    ['channel_id'],
    'prediction_automation_runs_channel_id',
  );
}

if (require.main === module) {
  void import('../db')
    .then(async ({ sequelize, dbReady }) => {
      await dbReady;
      await migratePredictionAutomation(sequelize.getQueryInterface());
      await sequelize.close();
    })
    .catch((error) => {
      logger.error('[Migration] Prediction automation migration failed:', error);
      process.exitCode = 1;
    });
}
