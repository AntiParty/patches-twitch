// db.ts
import { Sequelize, DataTypes, Model } from 'sequelize';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { error } from 'console';

dotenv.config();

console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('Using SQLite: true (forced)');

const dataDir = path.resolve(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdir(dataDir, {recursive: true});
}

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.resolve(__dirname, '../data/accounts.sqlite'),
  logging: false,
});

// Channel model
class Channel extends Model {}

// Custom command response model
class CustomResponse extends Model {}
CustomResponse.init(
  {
    channel: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    command: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    response: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
  },
  {
    sequelize,
    modelName: 'CustomResponse',
    tableName: 'CustomResponses',
    timestamps: false,
    indexes: [
      { unique: true, fields: ['channel', 'command'] }
    ]
  }
);

async function getCustomResponse(channel: string, command: string): Promise<string | null> {
  const row = await CustomResponse.findOne({ where: { channel, command } });
  return row ? row.get('response') as string : null;
}

async function setCustomResponse(channel: string, command: string, response: string): Promise<void> {
  await CustomResponse.upsert({ channel, command, response });
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
      allowNull: true,
      defaultValue: null,
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
}).catch(error => {
  console.error('database failed:', error);
  throw error;
});


export { sequelize, Channel, StreamSession, CustomResponse, dbReady };
export { getCustomResponse, setCustomResponse };