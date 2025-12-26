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
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000,
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
  })
  .then(() => {
    // Start periodic cleanup of old metrics (e.g., every 24 hours)
    const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000;
    setInterval(async () => {
      try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const deletedRequests = await RequestMetric.destroy({
          where: { timestamp: { [Op.lt]: thirtyDaysAgo } }
        });
        const deletedPerf = await PerformanceMetric.destroy({
          where: { timestamp: { [Op.lt]: thirtyDaysAgo } }
        });
        if (deletedRequests > 0 || deletedPerf > 0) {
          logger.info(`[metrics-db] Cleaned up ${deletedRequests} request logs and ${deletedPerf} performance logs older than 30 days.`);
        }
      } catch (err) {
        logger.error("[metrics-db] Failed to clean up old metrics:", err);
      }
    }, CLEANUP_INTERVAL);
  })
  .catch((err) => {
    logger.error("[metrics-db] failed to sync:", err);
    throw err;
  });
