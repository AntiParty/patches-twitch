import { DataTypes, QueryInterface } from 'sequelize';
import logger from '@/util/logger';

/**
 * Creates the sparse, additive command-control table. Existing channel data is
 * intentionally never altered: no row means all viewer commands stay enabled.
 */
export async function migrateDisabledChannelCommands(queryInterface: QueryInterface): Promise<void> {
  const table = await queryInterface.describeTable('DisabledChannelCommands').catch(() => null);
  if (table) return;

  logger.info('[Migration] Creating DisabledChannelCommands table...');
  await queryInterface.createTable('DisabledChannelCommands', {
    channel: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    command: {
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
  await queryInterface.addIndex('DisabledChannelCommands', ['channel', 'command'], {
    unique: true,
    name: 'disabled_channel_commands_channel_command_unique',
  });
  await queryInterface.addIndex('DisabledChannelCommands', ['channel'], {
    name: 'disabled_channel_commands_channel',
  });
  logger.info('[Migration] DisabledChannelCommands table created.');
}

if (require.main === module) {
  void import('../db')
    .then(async ({ sequelize, dbReady }) => {
      await dbReady;
      await migrateDisabledChannelCommands(sequelize.getQueryInterface());
      await sequelize.close();
    })
    .catch((error) => {
      logger.error('[Migration] DisabledChannelCommands migration failed:', error);
      process.exitCode = 1;
    });
}
