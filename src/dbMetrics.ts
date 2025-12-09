import { Sequelize, DataTypes, Model } from 'sequelize';
import path from 'path';
import logger from "@/util/logger"; // Logging utility
import fs from 'fs';

const dataDir = path.resolve(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

export const sequelizeMetrics = new Sequelize({
  dialect: 'sqlite',
  storage: path.resolve(__dirname, '../data/metrics.sqlite'),
  logging: false,
});

// Performance metric model (time-series)
export class PerformanceMetric extends Model { }
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
    modelName: 'PerformanceMetric',
    tableName: 'PerformanceMetrics',
    timestamps: false,
  }
);

/**
 * db for storing requests metrics
 * store: endpoint, method, responsetime, statusCode, RequestCount
 */
export class RequestMetric extends Model { }
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
    modelName: 'RequestMetric',
    tableName: 'RequestMetrics',
    timestamps: false,
  }
);

// Sync DB
export class AnalyticsDay extends Model { }
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
    modelName: 'AnalyticsDay',
    tableName: 'AnalyticsDays',
    timestamps: false,
  }
);
export const metricsDbReady = sequelizeMetrics.sync().then(() => {
  logger.info('[metrics-db] metrics DB ready');
}).catch(err => {
  logger.error('[metrics-db] failed to sync:', err);
  throw err;
});