import { DataTypes, Model, Sequelize } from 'sequelize';

export const PREDICTION_AUTOMATION_RUN_STATUSES = [
  'scheduled',
  'active',
  'resolving',
  'resolved',
  'canceled',
  'skipped',
] as const;

export type PredictionAutomationRunStatus =
  typeof PREDICTION_AUTOMATION_RUN_STATUSES[number];

export function initPredictionAutomationModels(sequelize: Sequelize) {
  class PredictionAutomationConfig extends Model {
    declare id: number;
    declare channel_id: number;
    declare enabled: boolean;
    declare start_delay_minutes: number;
    declare voting_window_seconds: number;
    declare created_at: Date;
    declare updated_at: Date;
  }

  class PredictionAutomationRun extends Model {
    declare id: number;
    declare channel_id: number;
    declare stream_started_at: Date;
    declare session_start_score: number;
    declare prediction_id: string | null;
    declare outcomes_json: string | null;
    declare status: PredictionAutomationRunStatus;
    declare offline_detected_at: Date | null;
    declare resolution_deadline_at: Date | null;
    declare last_resolution_attempt_at: Date | null;
    declare terminal_reason: string | null;
    declare created_at: Date;
    declare updated_at: Date;
  }

  PredictionAutomationConfig.init(
    {
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
        validate: {
          min: 1,
          max: 60,
        },
      },
      voting_window_seconds: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1800,
        validate: {
          min: 30,
          max: 1800,
        },
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
    },
    {
      sequelize,
      modelName: 'PredictionAutomationConfig',
      tableName: 'PredictionAutomationConfigs',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        {
          unique: true,
          fields: ['channel_id'],
          name: 'prediction_automation_configs_channel_unique',
        },
      ],
    },
  );

  PredictionAutomationRun.init(
    {
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
        type: DataTypes.ENUM(...PREDICTION_AUTOMATION_RUN_STATUSES),
        allowNull: false,
        validate: {
          isIn: [[...PREDICTION_AUTOMATION_RUN_STATUSES]],
        },
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
    },
    {
      sequelize,
      modelName: 'PredictionAutomationRun',
      tableName: 'PredictionAutomationRuns',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        {
          unique: true,
          fields: ['channel_id', 'stream_started_at'],
          name: 'prediction_automation_runs_channel_stream_unique',
        },
        {
          fields: ['status'],
          name: 'prediction_automation_runs_status',
        },
        {
          fields: ['channel_id'],
          name: 'prediction_automation_runs_channel_id',
        },
      ],
    },
  );

  return {
    PredictionAutomationConfig,
    PredictionAutomationRun,
  };
}
