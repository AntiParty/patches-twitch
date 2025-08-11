// db.ts
import { Sequelize, DataTypes, Model } from 'sequelize';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('Using SQLite: true (forced)');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.resolve(__dirname, '../accounts.sqlite'), // Absolute path for safety
  logging: false,
});

// Define the Channel model
class Channel extends Model {}
Channel.init(
  {
    username: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    player_id: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: null,
    },
    twitch_user_id: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    access_token: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    refresh_token: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    token_expires_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  },
  {
    sequelize,
    modelName: 'Channel',
    tableName: 'Channels', // explicitly specify table name if you want
  }
);

// Sync the database and export a promise for sync completion
const dbReady = sequelize.sync().then(() => {
  console.log('Database synced.');
});

export { sequelize, Channel, dbReady };