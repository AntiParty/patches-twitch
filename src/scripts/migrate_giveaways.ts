import { DataTypes, QueryInterface } from 'sequelize';
import logger from '@/util/logger';

export async function migrateGiveaways(queryInterface: QueryInterface): Promise<void> {
  const giveaways = await queryInterface.describeTable('Giveaways').catch(() => null);
  if (!giveaways) {
    logger.info('[Migration] Creating Giveaways table...');
    await queryInterface.createTable('Giveaways', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      channel: { type: DataTypes.STRING, allowNull: false },
      type: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'open' },
      prize: { type: DataTypes.STRING, allowNull: true },
      max_tickets_per_user: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      target_winner_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      winners_json: { type: DataTypes.TEXT, allowNull: false, defaultValue: '[]' },
      reward_id: { type: DataTypes.STRING, allowNull: true },
      reward_cost: { type: DataTypes.INTEGER, allowNull: true },
      winner_user_id: { type: DataTypes.STRING, allowNull: true },
      winner_username: { type: DataTypes.STRING, allowNull: true },
      winner_slot: { type: DataTypes.INTEGER, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      drawn_at: { type: DataTypes.DATE, allowNull: true },
      closed_at: { type: DataTypes.DATE, allowNull: true },
    });
    await queryInterface.addIndex('Giveaways', ['channel'], { name: 'giveaways_channel' });
    logger.info('[Migration] Giveaways table created.');
  }

  // Backfill columns added after the table's first release.
  const giveawaysCols = giveaways || (await queryInterface.describeTable('Giveaways').catch(() => null));
  if (giveawaysCols && !giveawaysCols.target_winner_count) {
    logger.info('[Migration] Adding target_winner_count + winners_json to Giveaways...');
    await queryInterface.addColumn('Giveaways', 'target_winner_count', {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    });
    await queryInterface.addColumn('Giveaways', 'winners_json', {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: '[]',
    });
  }

  if (giveawaysCols && !giveawaysCols.max_per_user_per_stream) {
    logger.info('[Migration] Adding reward limit columns to Giveaways...');
    await queryInterface.addColumn('Giveaways', 'max_per_user_per_stream', { type: DataTypes.INTEGER, allowNull: true });
    await queryInterface.addColumn('Giveaways', 'max_per_stream', { type: DataTypes.INTEGER, allowNull: true });
    await queryInterface.addColumn('Giveaways', 'cooldown_seconds', { type: DataTypes.INTEGER, allowNull: true });
  }

  const entries = await queryInterface.describeTable('GiveawayEntries').catch(() => null);
  if (!entries) {
    logger.info('[Migration] Creating GiveawayEntries table...');
    await queryInterface.createTable('GiveawayEntries', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      giveaway_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Giveaways', key: 'id' },
        onDelete: 'CASCADE',
      },
      user_id: { type: DataTypes.STRING, allowNull: false },
      username: { type: DataTypes.STRING, allowNull: false },
      redemption_id: { type: DataTypes.STRING, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });
    await queryInterface.addIndex('GiveawayEntries', ['giveaway_id'], {
      name: 'giveaway_entries_giveaway_id',
    });
    await queryInterface.addIndex('GiveawayEntries', ['giveaway_id', 'redemption_id'], {
      unique: true,
      name: 'giveaway_entries_giveaway_redemption_unique',
    });
    logger.info('[Migration] GiveawayEntries table created.');
  }
}

if (require.main === module) {
  void import('../db')
    .then(async ({ sequelize, dbReady }) => {
      await dbReady;
      await migrateGiveaways(sequelize.getQueryInterface());
      await sequelize.close();
    })
    .catch((error) => {
      logger.error('[Migration] Giveaways migration failed:', error);
      process.exitCode = 1;
    });
}
