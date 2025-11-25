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
  fs.mkdirSync(dataDir, { recursive: true });
}

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.resolve(__dirname, '../data/accounts.sqlite'),
  logging: false,
});

// Channel model
class Channel extends Model {}

// Custom command response model
// Utility functions for custom responses
async function getCustomResponse(channel: string, command: string): Promise<string | null> {
  const row = await CustomResponse.findOne({ where: { channel, command } });
  return row ? row.get('response') as string : null;
}

async function setCustomResponse(channel: string, command: string, response: string): Promise<void> {
  await CustomResponse.upsert({ channel, command, response });
}
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

// StreamSession model
class StreamSession extends Model {}
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
    hooks: {
      afterCreate: async (channel: Channel) => {
        const allowed = ['rank', 'record', 'peak'];
        const username = channel.get('username');
        for (const cmd of allowed) {
          await CustomResponse.findOrCreate({
            where: { channel: username, command: cmd },
            defaults: { response: '' }
          });
        }
      }
    }
  }
);

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
// Returns stream sessions started within the last 8 hours (adjust as needed)
import { Op } from 'sequelize';
export async function getActiveSessions() {
  const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000);
  return await StreamSession.findAll({
    where: {
      started_at: {
        [Op.gte]: eightHoursAgo
      }
    }
  });
}
export { getCustomResponse, setCustomResponse };