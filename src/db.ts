// db.ts
import { Sequelize, DataTypes, Model } from 'sequelize';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('Using SQLite: true (forced)');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.resolve(__dirname, '../data/accounts.sqlite'),
  logging: false,
});

// Channel model
// Removed duplicate Channel class definition. Typed version below.
interface ChannelAttributes {
  username: string;
  player_id?: string;
  twitch_user_id?: string;
  access_token?: string;
  refresh_token?: string;
  token_expires_at: Date;
}

class Channel extends Model<ChannelAttributes> implements ChannelAttributes {
  public username!: string;
  public player_id?: string;
  public twitch_user_id?: string;
  public access_token?: string;
  public refresh_token?: string;
  public token_expires_at!: Date;
}

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
    tableName: 'Channels',
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
    start_wt_rank: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
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
    timestamps: false 
  }
);

// Sync the database and export a promise for sync completion
const dbReady = sequelize.sync().then(() => {
  console.log('Database synced.');
});

export { sequelize, Channel, StreamSession ,dbReady };