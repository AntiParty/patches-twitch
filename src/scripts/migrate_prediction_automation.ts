import {
  DataTypes,
  Op,
  QueryInterface,
  QueryTypes,
} from 'sequelize';
import logger from '@/util/logger';
import {
  PREDICTION_AUTOMATION_RUN_STATUSES,
} from '@/models/predictionAutomation';

type ColumnDefinition = Parameters<QueryInterface['addColumn']>[2];
type ConstraintDefinition = Parameters<QueryInterface['addConstraint']>[1];
type Migration = (queryInterface: QueryInterface) => Promise<void>;

const configColumns: Record<string, ColumnDefinition> = {
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
};

const runColumns: Record<string, ColumnDefinition> = {
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
    type: DataTypes.STRING,
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
};

async function ensureColumns(
  queryInterface: QueryInterface,
  tableName: string,
  columns: Record<string, ColumnDefinition>,
): Promise<boolean> {
  const existing = await queryInterface.describeTable(tableName).catch(() => null);
  if (!existing) {
    await queryInterface.createTable(tableName, columns);
    return true;
  }

  for (const [columnName, definition] of Object.entries(columns)) {
    if (!existing[columnName]) {
      await queryInterface.addColumn(tableName, columnName, definition);
    }
  }
  return false;
}

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

async function ensureCheckConstraint(
  queryInterface: QueryInterface,
  tableName: string,
  definition: ConstraintDefinition & { name: string },
): Promise<void> {
  const tableRows = await queryInterface.sequelize.query<{ sql: string }>(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`,
    {
      replacements: [tableName],
      type: QueryTypes.SELECT,
    },
  );
  if (tableRows[0]?.sql?.includes(definition.name)) return;

  const countRows = await queryInterface.sequelize.query<{ count: number }>(
    `SELECT COUNT(*) AS count FROM "${tableName}"`,
    { type: QueryTypes.SELECT },
  );
  if (Number(countRows[0]?.count ?? 0) > 0) {
    logger.warn(
      `[Migration] Skipping ${definition.name} on populated ${tableName}; ` +
      'SQLite would rebuild the table to add the CHECK constraint.',
    );
    return;
  }

  await queryInterface.addConstraint(tableName, definition);
}

export async function migratePredictionAutomation(
  queryInterface: QueryInterface,
): Promise<void> {
  const createdConfigTable = await ensureColumns(
    queryInterface,
    'PredictionAutomationConfigs',
    configColumns,
  );
  if (createdConfigTable) {
    logger.info('[Migration] PredictionAutomationConfigs table created.');
  }

  await ensureCheckConstraint(
    queryInterface,
    'PredictionAutomationConfigs',
    {
      fields: ['start_delay_minutes'],
      type: 'check',
      name: 'prediction_automation_configs_start_delay_check',
      where: {
        start_delay_minutes: {
          [Op.between]: [1, 60],
        },
      },
    },
  );
  await ensureCheckConstraint(
    queryInterface,
    'PredictionAutomationConfigs',
    {
      fields: ['voting_window_seconds'],
      type: 'check',
      name: 'prediction_automation_configs_voting_window_check',
      where: {
        voting_window_seconds: {
          [Op.between]: [30, 1800],
        },
      },
    },
  );
  await ensureIndex(
    queryInterface,
    'PredictionAutomationConfigs',
    ['channel_id'],
    'prediction_automation_configs_channel_unique',
    true,
  );

  const createdRunTable = await ensureColumns(
    queryInterface,
    'PredictionAutomationRuns',
    runColumns,
  );
  if (createdRunTable) {
    logger.info('[Migration] PredictionAutomationRuns table created.');
  }

  await ensureCheckConstraint(
    queryInterface,
    'PredictionAutomationRuns',
    {
      fields: ['status'],
      type: 'check',
      name: 'prediction_automation_runs_status_check',
      where: {
        status: {
          [Op.in]: [...PREDICTION_AUTOMATION_RUN_STATUSES],
        },
      },
    },
  );

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

export async function runPredictionAutomationStartupMigration(
  queryInterface: QueryInterface,
  migration: Migration = migratePredictionAutomation,
): Promise<void> {
  await migration(queryInterface);
}

if (require.main === module) {
  void import('../db')
    .then(async ({ sequelize, dbReady }) => {
      await dbReady;
      await runPredictionAutomationStartupMigration(
        sequelize.getQueryInterface(),
      );
      await sequelize.close();
    })
    .catch((error) => {
      logger.error('[Migration] Prediction automation migration failed:', error);
      process.exitCode = 1;
    });
}
