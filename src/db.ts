// db.ts
import { Sequelize, DataTypes, Model } from 'sequelize';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { error } from 'console';
import logger from "@/util/logger"; // Logging utility
import { Op } from 'sequelize';
import { migratePredictionPresets } from './scripts/migrate_prediction_presets';
import { migratePredictionAutomation } from './scripts/migrate_prediction_automation';

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
  declare has_subscription: boolean;
  declare subscription_tier: string | null;
  declare notify_chat_reminders: boolean;
  declare auth_revoked: boolean;
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

class PredictionPreset extends Model {
  declare id: number;
  declare channel_id: number;
  declare alias: string;
  declare title: string;
  declare outcomes_json: string;
  declare duration_seconds: number;
  declare created_at: Date;
  declare updated_at: Date;
}

class PredictionAutomationConfig extends Model {
  declare id: number;
  declare broadcaster_id: number;
  declare enabled: boolean;
  declare start_delay_seconds: number;
  declare voting_window_seconds: number;
  declare question: string;
  declare outcomes_json: string;
  declare created_at: Date;
  declare updated_at: Date;
}

class PredictionAutomationRun extends Model {
  declare id: number;
  declare broadcaster_id: number;
  declare twitch_stream_id: string;
  declare status: string;
  declare twitch_prediction_id: string | null;
  declare twitch_outcome_ids_json: string | null;
  declare prediction_created_at: Date | null;
  declare resolved_at: Date | null;
  declare failure_reason: string | null;
  declare created_at: Date;
  declare updated_at: Date;
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
    has_subscription: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    subscription_tier: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: null,
    },
    notify_chat_reminders: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    auth_revoked: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
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

PredictionPreset.init(
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
  },
  {
    sequelize,
    modelName: 'PredictionPreset',
    tableName: 'PredictionPresets',
    timestamps: false,
    indexes: [
      { unique: true, fields: ['channel_id', 'alias'] },
      { fields: ['channel_id'] },
    ],
  }
);

PredictionAutomationConfig.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    broadcaster_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
      references: { model: 'Channels', key: 'id' },
    },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    start_delay_seconds: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 600 },
    voting_window_seconds: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 600 },
    question: {
      type: DataTypes.STRING(45),
      allowNull: false,
      defaultValue: 'How much RS will I gain this stream?',
    },
    outcomes_json: { type: DataTypes.TEXT, allowNull: false },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    modelName: 'PredictionAutomationConfig',
    tableName: 'PredictionAutomationConfigs',
    timestamps: false,
    indexes: [{ unique: true, fields: ['broadcaster_id'] }],
  },
);

PredictionAutomationRun.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    broadcaster_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'Channels', key: 'id' },
    },
    twitch_stream_id: { type: DataTypes.STRING(64), allowNull: false },
    status: { type: DataTypes.STRING(32), allowNull: false },
    twitch_prediction_id: { type: DataTypes.STRING(64), allowNull: true },
    twitch_outcome_ids_json: { type: DataTypes.TEXT, allowNull: true },
    prediction_created_at: { type: DataTypes.DATE, allowNull: true },
    resolved_at: { type: DataTypes.DATE, allowNull: true },
    failure_reason: { type: DataTypes.STRING(255), allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    modelName: 'PredictionAutomationRun',
    tableName: 'PredictionAutomationRuns',
    timestamps: false,
    indexes: [
      { unique: true, fields: ['broadcaster_id', 'twitch_stream_id'] },
      { fields: ['status'] },
    ],
  },
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

    // Add has_subscription column if missing
    if (!tableInfo.has_subscription) {
      logger.info('[Migration] Adding has_subscription column to Channels table...');
      await queryInterface.addColumn('Channels', 'has_subscription', {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
      logger.info('[Migration] has_subscription column added successfully.');
    }

    // Add subscription_tier column if missing
    if (!tableInfo.subscription_tier) {
      logger.info('[Migration] Adding subscription_tier column to Channels table...');
      await queryInterface.addColumn('Channels', 'subscription_tier', {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
      });
      logger.info('[Migration] subscription_tier column added successfully.');
    }

    // Add notify_chat_reminders column if missing
    if (!tableInfo.notify_chat_reminders) {
      logger.info('[Migration] Adding notify_chat_reminders column to Channels table...');
      await queryInterface.addColumn('Channels', 'notify_chat_reminders', {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      });
      logger.info('[Migration] notify_chat_reminders column added successfully.');
    }

    // Add auth_revoked column if missing
    if (!tableInfo.auth_revoked) {
      logger.info('[Migration] Adding auth_revoked column to Channels table...');
      await queryInterface.addColumn('Channels', 'auth_revoked', {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
      logger.info('[Migration] auth_revoked column added successfully.');
    }

    await migratePredictionPresets(queryInterface);
    await migratePredictionAutomation(queryInterface);
  } catch (err) {
    logger.error('[Migration] Migration error:', err);
  }
}

// Sync the database and export a promise for sync completion
const dbReady = migratePredictionAutomation(sequelize.getQueryInterface())
  .then(() => sequelize.sync())
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

// Subscription model - Track paid subscriptions
class Subscription extends Model {
  declare id: number;
  declare channel_id: number;
  declare stripe_customer_id: string | null;
  declare stripe_subscription_id: string | null;
  declare status: string;
  declare plan_type: string;
  declare current_period_start: Date | null;
  declare current_period_end: Date | null;
  declare created_at: Date;
  declare updated_at: Date;
}

Subscription.init(
  {
    channel_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Channels',
        key: 'id',
      },
    },
    stripe_customer_id: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
    },
    stripe_subscription_id: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'inactive', // active, canceled, past_due, inactive
    },
    plan_type: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'custom_bot',
    },
    current_period_start: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    current_period_end: {
      type: DataTypes.DATE,
      allowNull: true,
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
    modelName: 'Subscription',
    tableName: 'Subscriptions',
    timestamps: false,
    indexes: [
      { fields: ['channel_id'] },
      { fields: ['stripe_customer_id'] },
      { fields: ['stripe_subscription_id'] },
      { fields: ['status'] },
    ],
  }
);

// CustomBotAccount model - Track custom Twitch bot accounts
class CustomBotAccount extends Model {
  declare id: number;
  declare channel_id: number;
  declare bot_username: string;
  declare bot_twitch_user_id: string;
  declare bot_access_token: string;
  declare bot_refresh_token: string;
  declare bot_token_expires_at: Date | null;
  declare is_active: boolean;
  declare created_at: Date;
  declare updated_at: Date;
}

CustomBotAccount.init(
  {
    channel_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Channels',
        key: 'id',
      },
    },
    bot_username: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    bot_twitch_user_id: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    bot_access_token: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    bot_refresh_token: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    bot_token_expires_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
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
    modelName: 'CustomBotAccount',
    tableName: 'CustomBotAccounts',
    timestamps: false,
    indexes: [
      { fields: ['channel_id'] },
      { fields: ['bot_twitch_user_id'] },
      { fields: ['is_active'] },
    ],
  }
);


// PeakRank model - stores best rank ever achieved per channel
class PeakRank extends Model {
  declare channel: string;
  declare player_id: string;
  declare regular_rank: number | null;
  declare regular_rs: number | null;
  declare regular_league: string | null;
  declare regular_season: string | null;
  declare wt_rank: number | null;
  declare wt_season: string | null;
  declare updated_at: Date;
}

PeakRank.init(
  {
    channel: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    player_id: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    regular_rank: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    regular_rs: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    regular_league: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    regular_season: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    wt_rank: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    wt_season: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    modelName: 'PeakRank',
    tableName: 'PeakRanks',
    timestamps: false,
    indexes: [
      { fields: ['channel'], unique: true },
      { fields: ['player_id'] },
    ],
  }
);

export async function getActiveSessions() {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return await StreamSession.findAll({
    where: {
      started_at: {
        [Op.gte]: twentyFourHoursAgo
      }
    }
  });
}

export { sequelize, Channel, StreamSession, PredictionPreset, PredictionAutomationConfig, PredictionAutomationRun, CustomResponse, RankGoal, CommandUsage, Feedback, Subscription, CustomBotAccount, PeakRank, dbReady, getCustomResponse, setCustomResponse };
