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

// Daily analytics summary
export class AnalyticsDay extends Model { }
AnalyticsDay.init(
  {
    day: { type: DataTypes.STRING, primaryKey: true }, // YYYY-MM-DD
    totalRequests: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    perRoute: { type: DataTypes.TEXT, allowNull: true }, // JSON
    uniqueVisitors: { type: DataTypes.INTEGER, allowNull: true },
    avgResponseTimeMs: { type: DataTypes.INTEGER, allowNull: true },
    p95ResponseTimeMs: { type: DataTypes.INTEGER, allowNull: true },
    statusCodes: { type: DataTypes.TEXT, allowNull: true }, // JSON
    userAgents: { type: DataTypes.TEXT, allowNull: true }, // JSON
    referrers: { type: DataTypes.TEXT, allowNull: true }, // JSON
    rawUniqueIps: { type: DataTypes.TEXT, allowNull: true } // optional raw IP list (JSON)
  },
  {
    sequelize: sequelizeMetrics,
    modelName: 'AnalyticsDay',
    tableName: 'AnalyticsDays',
    timestamps: false,
  }
);

// Sync DB
export const metricsDbReady = sequelizeMetrics.sync().then(() => {
  logger.info('[metrics-db] metrics DB ready');
}).catch(err => {
  logger.error('[metrics-db] failed to sync:', err);
  throw err;
});