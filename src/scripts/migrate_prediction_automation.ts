import { DataTypes, QueryInterface } from 'sequelize';
import logger from '@/util/logger';

export async function migratePredictionAutomation(
  queryInterface: QueryInterface,
): Promise<void> {
  let configTable = await queryInterface
    .describeTable('PredictionAutomationConfigs')
    .catch(() => null);
  if (configTable && !configTable.broadcaster_id) {
    logger.warn('[Migration] Replacing reverted legacy PredictionAutomationConfigs schema.');
    await queryInterface.dropTable('PredictionAutomationConfigs');
    configTable = null;
  }
  if (!configTable) {
    await queryInterface.createTable('PredictionAutomationConfigs', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      broadcaster_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
        references: { model: 'Channels', key: 'id' },
        onDelete: 'CASCADE',
      },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      mode: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'stream_total' },
      start_delay_seconds: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 600 },
      voting_window_seconds: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 600 },
      question: {
        type: DataTypes.STRING(45),
        allowNull: false,
        defaultValue: 'How much RS will I gain this stream?',
      },
      outcomes_json: { type: DataTypes.TEXT, allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });
    await queryInterface.addIndex('PredictionAutomationConfigs', ['broadcaster_id'], {
      unique: true,
      name: 'prediction_automation_config_broadcaster_unique',
    });
    logger.info('[Migration] PredictionAutomationConfigs table created.');
  } else if (!configTable.mode) {
    await queryInterface.addColumn('PredictionAutomationConfigs', 'mode', {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'stream_total',
    });
  }

  let runTable = await queryInterface
    .describeTable('PredictionAutomationRuns')
    .catch(() => null);
  if (runTable && !runTable.twitch_stream_id) {
    logger.warn('[Migration] Replacing reverted legacy PredictionAutomationRuns schema.');
    await queryInterface.dropTable('PredictionAutomationRuns');
    runTable = null;
  }
  if (!runTable) {
    await queryInterface.createTable('PredictionAutomationRuns', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      broadcaster_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Channels', key: 'id' },
        onDelete: 'CASCADE',
      },
      twitch_stream_id: { type: DataTypes.STRING(64), allowNull: false },
      mode: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'stream_total' },
      cycle_index: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      status: { type: DataTypes.STRING(32), allowNull: false },
      twitch_prediction_id: { type: DataTypes.STRING(64), allowNull: true },
      twitch_outcome_ids_json: { type: DataTypes.TEXT, allowNull: true },
      prediction_created_at: { type: DataTypes.DATE, allowNull: true },
      baseline_rs: { type: DataTypes.INTEGER, allowNull: true },
      resolution_deadline_at: { type: DataTypes.DATE, allowNull: true },
      cooldown_until: { type: DataTypes.DATE, allowNull: true },
      resolved_at: { type: DataTypes.DATE, allowNull: true },
      failure_reason: { type: DataTypes.STRING(255), allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });
    await queryInterface.addIndex(
      'PredictionAutomationRuns',
      ['broadcaster_id', 'twitch_stream_id', 'cycle_index'],
      {
        unique: true,
        name: 'prediction_automation_run_cycle_unique',
      },
    );
    await queryInterface.addIndex('PredictionAutomationRuns', ['status'], {
      name: 'prediction_automation_run_status',
    });
    logger.info('[Migration] PredictionAutomationRuns table created.');
  } else {
    const additions: Array<[string, any]> = [
      ['mode', {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'stream_total',
      }],
      ['cycle_index', {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      }],
      ['baseline_rs', { type: DataTypes.INTEGER, allowNull: true }],
      ['resolution_deadline_at', { type: DataTypes.DATE, allowNull: true }],
      ['cooldown_until', { type: DataTypes.DATE, allowNull: true }],
    ];
    for (const [column, definition] of additions) {
      if (!runTable[column]) {
        await queryInterface.addColumn('PredictionAutomationRuns', column, definition);
      }
    }

    const indexes = await queryInterface.showIndex('PredictionAutomationRuns') as any[];
    const legacyUniqueIndexes = indexes.filter((index: any) => (
      index.unique
      && index.fields?.map((field: any) => field.attribute).join(',')
        === 'broadcaster_id,twitch_stream_id'
    ));
    for (const index of legacyUniqueIndexes) {
      await queryInterface.removeIndex('PredictionAutomationRuns', index.name);
    }
    if (!indexes.some((index: any) => index.name === 'prediction_automation_run_cycle_unique')) {
      await queryInterface.addIndex(
        'PredictionAutomationRuns',
        ['broadcaster_id', 'twitch_stream_id', 'cycle_index'],
        {
          unique: true,
          name: 'prediction_automation_run_cycle_unique',
        },
      );
    }
  }
}
