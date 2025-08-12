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

class StreamSession extends Model {}
StreamSession.init(
  {
    channel: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    start_score: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    started_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    modelName: 'StreamSession',
    tableName: 'StreamSessions',
    timestamps: false // Disable createdAt/updatedAt columns
  }
);

// Sync the database and export a promise for sync completion
const dbReady = sequelize.sync().then(() => {
  console.log('Database synced.');
});

export { sequelize, Channel, StreamSession ,dbReady };