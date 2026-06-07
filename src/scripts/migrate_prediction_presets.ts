import { DataTypes, QueryInterface } from 'sequelize';
import logger from '@/util/logger';

export async function migratePredictionPresets(queryInterface: QueryInterface): Promise<void> {
  const table = await queryInterface.describeTable('PredictionPresets').catch(() => null);
  if (table) return;

  logger.info('[Migration] Creating PredictionPresets table...');
  await queryInterface.createTable('PredictionPresets', {
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
    alias: {
      type: DataTypes.STRING(24),
      allowNull: false,
    },
    title: {
      type: DataTypes.STRING(45),
      allowNull: false,
    },
    outcomes_json: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    duration_seconds: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 120,
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
  await queryInterface.addIndex('PredictionPresets', ['channel_id', 'alias'], {
    unique: true,
    name: 'prediction_presets_channel_alias_unique',
  });
  await queryInterface.addIndex('PredictionPresets', ['channel_id'], {
    name: 'prediction_presets_channel_id',
  });
  logger.info('[Migration] PredictionPresets table created.');
}

if (require.main === module) {
  void import('../db')
    .then(async ({ sequelize, dbReady }) => {
      await dbReady;
      await migratePredictionPresets(sequelize.getQueryInterface());
      await sequelize.close();
    })
    .catch((error) => {
      logger.error('[Migration] PredictionPresets migration failed:', error);
      process.exitCode = 1;
    });
}
