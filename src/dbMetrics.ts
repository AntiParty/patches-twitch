import { Sequelize, DataTypes, Model, Op } from "sequelize";
import path from "path";
import logger from "@/util/logger"; // Logging utility
import fs from "fs";

const dataDir = path.resolve(__dirname, "../data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

export const sequelizeMetrics = new Sequelize({
  dialect: "sqlite",
  storage: path.resolve(__dirname, "../data/metrics.sqlite"),
  logging: false,
  pool: {
    max: 3, // Reduced from 5 to lower memory overhead
    min: 0,
    acquire: 30000,
    idle: 5000, // Reduced from 10s to free connections faster
  },
  retry: {
    max: 3,
    match: [/SQLITE_BUSY/, /database is locked/],
  },
});

// Performance metric model (time-series)
export class PerformanceMetric extends Model {}
PerformanceMetric.init(
  {
    timestamp: { type: DataTypes.DATE, allowNull: false },
    cpuUsage: { type: DataTypes.FLOAT, allowNull: false },
    loadAvg: { type: DataTypes.TEXT, allowNull: true }, // JSON array
    memoryTotal: { type: DataTypes.BIGINT, allowNull: true },
    memoryUsed: { type: DataTypes.BIGINT, allowNull: true },
    heapUsed: { type: DataTypes.BIGINT, allowNull: true },
    heapTotal: { type: DataTypes.BIGINT, allowNull: true },
    botLatencyMs: { type: DataTypes.FLOAT, allowNull: true },
    connectedChannels: { type: DataTypes.INTEGER, allowNull: true },
    extra: { type: DataTypes.TEXT, allowNull: true }, // JSON blob for future use
  },
  {
    sequelize: sequelizeMetrics,
    modelName: "PerformanceMetric",
    tableName: "PerformanceMetrics",
    timestamps: false,
  }
);

/**
 * db for storing requests metrics
 * store: endpoint, method, responsetime, statusCode, RequestCount
 */
export class RequestMetric extends Model {}
RequestMetric.init(
  {
    timestamp: { type: DataTypes.DATE, allowNull: false },
    endpoint: { type: DataTypes.STRING, allowNull: false },
    method: { type: DataTypes.STRING, allowNull: false },
    responseTimeMs: { type: DataTypes.FLOAT, allowNull: false },
    statusCode: { type: DataTypes.INTEGER, allowNull: false },
    ip: { type: DataTypes.STRING, allowNull: true },
    userAgent: { type: DataTypes.STRING, allowNull: true },
    referer: { type: DataTypes.STRING, allowNull: true },
  },
  {
    sequelize: sequelizeMetrics,
    modelName: "RequestMetric",
    tableName: "RequestMetrics",
    timestamps: false,
    indexes: [
      { fields: ["timestamp"] }
    ]
  }
);

// Sync DB
export class AnalyticsDay extends Model {}
AnalyticsDay.init(
  {
    day: { type: DataTypes.STRING, primaryKey: true },
    totalRequests: { type: DataTypes.INTEGER, defaultValue: 0 },
    perRoute: { type: DataTypes.TEXT, allowNull: true },
    uniqueVisitors: { type: DataTypes.INTEGER, defaultValue: 0 },
    avgResponseTimeMs: { type: DataTypes.FLOAT, defaultValue: 0 },
    p95ResponseTimeMs: { type: DataTypes.FLOAT, defaultValue: 0 },
    statusCodes: { type: DataTypes.TEXT, allowNull: true },
    userAgents: { type: DataTypes.TEXT, allowNull: true },
    referrers: { type: DataTypes.TEXT, allowNull: true },
    rawUniqueIps: { type: DataTypes.TEXT, allowNull: true }, // Store raw IPs to re-hydrate Sets if needed
  },
  {
    sequelize: sequelizeMetrics,
    modelName: "AnalyticsDay",
    tableName: "AnalyticsDays",
    timestamps: false,
  }
);
// IGN Visit model for the YouTube/IGN experiment
export class IGNVisit extends Model {}
IGNVisit.init(
  {
    timestamp: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    ip: { type: DataTypes.STRING, allowNull: true },
    userAgent: { type: DataTypes.STRING, allowNull: true },
    referer: { type: DataTypes.STRING, allowNull: true },
    path: { type: DataTypes.STRING, allowNull: false },
    isLive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    streamId: { type: DataTypes.STRING, allowNull: true },
    streamTitle: { type: DataTypes.STRING, allowNull: true },
  },
  {
    sequelize: sequelizeMetrics,
    modelName: "IGNVisit",
    tableName: "IGNVisits",
    timestamps: false,
    indexes: [
      { fields: ["timestamp"] }
    ]
  }
);

// Referral model - Track traffic sources
export class Referral extends Model {
  declare source: string;
  declare timestamp: Date;
}

Referral.init(
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    source: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    timestamp: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize: sequelizeMetrics,
    modelName: "Referral",
    tableName: "Referrals",
    timestamps: false,
    indexes: [
      { fields: ["source"] },
      { fields: ["timestamp"] }
    ]
  }
);

export const metricsDbReady = sequelizeMetrics
  .sync()
  .then(async () => {
    // Enable WAL mode for better concurrent access
    try {
      await sequelizeMetrics.query("PRAGMA journal_mode=WAL;");
      await sequelizeMetrics.query("PRAGMA busy_timeout=5000;"); // 5 second timeout
      logger.info("[metrics-db] metrics DB ready (WAL mode enabled)");
    } catch (err) {
      logger.warn("[metrics-db] Could not enable WAL mode:", err);
      logger.info("[metrics-db] metrics DB ready (default mode)");
    }

    // Migration for IGNVisit isLive column
    try {
      const queryInterface = sequelizeMetrics.getQueryInterface();
      const tableInfo = await queryInterface.describeTable('IGNVisits').catch(() => null);
      if (tableInfo && !tableInfo.isLive) {
        logger.info("[metrics-db] Adding isLive column to IGNVisits...");
        await queryInterface.addColumn('IGNVisits', 'isLive', {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false
        });
      }
      if (tableInfo && !tableInfo.streamId) {
        logger.info("[metrics-db] Adding streamId column to IGNVisits...");
        await queryInterface.addColumn('IGNVisits', 'streamId', {
          type: DataTypes.STRING,
          allowNull: true
        });
      }
      if (tableInfo && !tableInfo.streamTitle) {
        logger.info("[metrics-db] Adding streamTitle column to IGNVisits...");
        await queryInterface.addColumn('IGNVisits', 'streamTitle', {
          type: DataTypes.STRING,
          allowNull: true
        });
      }
    } catch (err) {
      logger.error("[metrics-db] IGNVisits migration failed:", err);
    }
  })
  .then(() => {
    // Cleanup function to remove old metrics and reduce database bloat
    const cleanupOldMetrics = async () => {
      try {
        const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

        // More aggressive cleanup to prevent 1M+ row accumulation
        const deletedRequests = await RequestMetric.destroy({
          where: { timestamp: { [Op.lt]: sixtyDaysAgo } }
        });
        // Performance metrics are high-frequency (every 5s), keep only 7 days
        const deletedPerf = await PerformanceMetric.destroy({
          where: { timestamp: { [Op.lt]: sevenDaysAgo } }
        });
        const deletedIGN = await IGNVisit.destroy({
          where: { timestamp: { [Op.lt]: threeDaysAgo } }
        });

        if (deletedRequests > 0 || deletedPerf > 0 || deletedIGN > 0) {
          logger.info(`[metrics-db] Cleaned up ${deletedRequests} reqs (60d), ${deletedPerf} perf (7d), ${deletedIGN} IGN (3d)`);
          
          // Run VACUUM to reclaim disk space after large deletions
          if (deletedPerf > 10000 || deletedRequests > 1000) {
            logger.info('[metrics-db] Running VACUUM to reclaim disk space...');
            await sequelizeMetrics.query('VACUUM;');
            logger.info('[metrics-db] VACUUM complete');
          }
        }
      } catch (err) {
        logger.error("[metrics-db] Failed to clean up old metrics:", err);
      }
    };

    // Run cleanup immediately on startup to clear existing bloat
    logger.info('[metrics-db] Running initial cleanup...');
    cleanupOldMetrics().catch(err => logger.error('[metrics-db] Initial cleanup failed:', err));
    
    // Run cleanup every 6 hours instead of 24 (more aggressive)
    const CLEANUP_INTERVAL = 6 * 60 * 60 * 1000;
    setInterval(cleanupOldMetrics, CLEANUP_INTERVAL);
    logger.info('[metrics-db] Scheduled cleanup every 6 hours');
  })
  .catch((err) => {
    logger.error("[metrics-db] failed to sync:", err);
    throw err;
  });