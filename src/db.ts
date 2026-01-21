// db.ts
import { Sequelize, DataTypes, Model } from 'sequelize';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { error } from 'console';
import logger from "@/util/logger"; // Logging utility
import { Op } from 'sequelize';

dotenv.config();

logger.info('NODE_ENV:', process.env.NODE_ENV);
logger.info('Using SQLite: true (forced)');

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
// add bot_enabled boolean to Channel model
class Channel extends Model {
  declare id: number;
  declare username: string;
  declare player_id: string | null;
  declare twitch_user_id: string | null;
  declare access_token: string | null;
  declare refresh_token: string | null;
  declare token_expires_at: Date | null;
  declare overlay_token: string | null;
  declare overlay_theme: string | null;
  declare overlay_color: string | null;
  declare overlay_layout: string | null;
  declare session_start_rs: number | null;
  declare bot_enabled: boolean;
  declare role: string;
  declare banned: boolean;
  declare ban_reason: string | null;
  declare is_live: boolean;
  declare stream_thumbnail_url: string | null;
}


// Custom command response model
// Utility functions for custom responses
async function getCustomResponse(channel: string, command: string): Promise<string | null> {
  const row = await CustomResponse.findOne({ where: { channel, command } });
  return row ? row.get('response') as string : null;
}

async function setCustomResponse(channel: string, command: string, response: string): Promise<void> {
  await CustomResponse.upsert({ channel, command, response });
}


class CustomResponse extends Model { }
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
class StreamSession extends Model {
  declare channel: string;
  declare start_score: number;
  declare start_wt_rank: number | null;
  declare started_at: Date;
}

// Channel model initialization
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
    overlay_token: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
    },
    overlay_theme: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: 'minimal',
    },
    overlay_color: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: '#9147ff',
    },
    overlay_layout: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: 'compact',
    },
    session_start_rs: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
    },
    bot_enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    role: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'Basic user',
    },
    banned: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    ban_reason: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    is_live: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    stream_thumbnail_url: {
      type: DataTypes.STRING,
      allowNull: true,
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

// RankGoal model - Track user rank goals
class RankGoal extends Model { }
RankGoal.init(
  {
    channel: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    target_rank: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    target_rank_score: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    starting_rank: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    starting_rank_score: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    achieved: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    achieved_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'RankGoal',
    tableName: 'RankGoals',
    timestamps: false,
  }
);

// CommandUsage model - Track command analytics
class CommandUsage extends Model { }
CommandUsage.init(
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    channel: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    command: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    user: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    user_id: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    success: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    response_time_ms: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    error_message: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    timestamp: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    modelName: 'CommandUsage',
    tableName: 'CommandUsage',
    timestamps: false,
    indexes: [
      { fields: ['channel', 'timestamp'] },
      { fields: ['command', 'timestamp'] },
      { fields: ['user', 'timestamp'] },
      { fields: ['timestamp'] },
    ]
  }
);

/**
 * Simple migration runner to add missing columns without wiping the DB.
 */
async function runMigrations() {
  const queryInterface = sequelize.getQueryInterface();
  try {
    // Check if Channels table exists
    const tableInfo = await queryInterface.describeTable('Channels').catch(() => null);
    if (!tableInfo) return; // Table doesn't exist yet, sync() will handle it

    // Add bot_enabled if missing
    if (!tableInfo.bot_enabled) {
      logger.info('[Migration] Adding bot_enabled column to Channels table...');
      await queryInterface.addColumn('Channels', 'bot_enabled', {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      });
      logger.info('[Migration] bot_enabled column added successfully.');
    }

    // Add overlay columns if missing
    if (!tableInfo.overlay_theme) {
      logger.info('[Migration] Adding overlay_theme column to Channels table...');
      await queryInterface.addColumn('Channels', 'overlay_theme', {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: 'minimal',
      });
    }
    if (!tableInfo.overlay_color) {
      logger.info('[Migration] Adding overlay_color column to Channels table...');
      await queryInterface.addColumn('Channels', 'overlay_color', {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: '#9147ff',
      });
    }
    if (!tableInfo.overlay_layout) {
      logger.info('[Migration] Adding overlay_layout column to Channels table...');
      await queryInterface.addColumn('Channels', 'overlay_layout', {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: 'compact',
      });
    }
    if (!tableInfo.session_start_rs) {
      logger.info('[Migration] Adding session_start_rs column to Channels table...');
      await queryInterface.addColumn('Channels', 'session_start_rs', {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: null,
      });
    }

    // Add role column if missing
    if (!tableInfo.role) {
      logger.info('[Migration] Adding role column to Channels table...');
      await queryInterface.addColumn('Channels', 'role', {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'Basic user',
      });
      logger.info('[Migration] role column added successfully.');
    }

    // Add banned column if missing
    if (!tableInfo.banned) {
      logger.info('[Migration] Adding banned column to Channels table...');
      await queryInterface.addColumn('Channels', 'banned', {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
      logger.info('[Migration] banned column added successfully.');
    }

    // Add ban_reason column if missing
    if (!tableInfo.ban_reason) {
      logger.info('[Migration] Adding ban_reason column to Channels table...');
      await queryInterface.addColumn('Channels', 'ban_reason', {
        type: DataTypes.STRING,
        allowNull: true,
      });
      logger.info('[Migration] ban_reason column added successfully.');
    }

    // Add is_live column if missing
    if (!tableInfo.is_live) {
      logger.info('[Migration] Adding is_live column to Channels table...');
      await queryInterface.addColumn('Channels', 'is_live', {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
      logger.info('[Migration] is_live column added successfully.');
    }

    // Add stream_thumbnail_url column if missing
    if (!tableInfo.stream_thumbnail_url) {
      logger.info('[Migration] Adding stream_thumbnail_url column to Channels table...');
      await queryInterface.addColumn('Channels', 'stream_thumbnail_url', {
        type: DataTypes.STRING,
        allowNull: true,
      });
      logger.info('[Migration] stream_thumbnail_url column added successfully.');
    }
  } catch (err) {
    logger.error('[Migration] Migration error:', err);
  }
}

// Sync the database and export a promise for sync completion
const dbReady = sequelize.sync()
  .then(async () => {
    await runMigrations();
    logger.info('Database synced and migrations checked.');
  })
  .catch(error => {
    logger.error('database failed:', error);
    throw error;
  });

// Returns stream sessions started within the last 8 hours (adjust as needed)

// Feedback model
class Feedback extends Model {
  declare id: number;
  declare user_id: string | null;
  declare username: string | null;
  declare message: string;
  declare type: string;
  declare created_at: Date;
}

Feedback.init(
  {
    user_id: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    username: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    type: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'general',
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    modelName: 'Feedback',
    tableName: 'Feedback',
    timestamps: false,
  }
);

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

export { sequelize, Channel, StreamSession, CustomResponse, RankGoal, CommandUsage, Feedback, dbReady, getCustomResponse, setCustomResponse };