import { EventEmitter } from 'events';
import os from 'os';
import { PerformanceMetric, metricsDbReady } from '@/dbMetrics';
import logger from '@/util/logger';

export interface PerformanceMetrics {
  cpu: {
    usage: number;
    loadAvg: number[];
  };
  memory: {
    total: number;
    used: number;
    free: number;
    heapUsed: number;
    heapTotal: number;
  };
  uptime: number;
  botLatency: number;
  connectedChannels: number;
  lastUpdate: number;
}

class PerformanceMonitor extends EventEmitter {
  private metrics: PerformanceMetrics;
  private updateInterval: NodeJS.Timeout;

  constructor() {
    super();
    this.metrics = this.getInitialMetrics();
    this.updateInterval = setInterval(() => this.updateMetrics(), 5000);
  }

  private getInitialMetrics(): PerformanceMetrics {
    const mem = process.memoryUsage();
    return {
      cpu: {
        usage: 0,
        loadAvg: os.loadavg(),
      },
      memory: {
        total: os.totalmem(),
        used: os.totalmem() - os.freemem(),
        free: os.freemem(),
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
      },
      uptime: process.uptime(),
      botLatency: 0,
      connectedChannels: 0,
      lastUpdate: Date.now(),
    };
  }

  private async updateMetrics() {
    const startTime = process.hrtime();
    const mem = process.memoryUsage();

    this.metrics = {
      cpu: {
        usage: os.loadavg()[0] / os.cpus().length * 100,
        loadAvg: os.loadavg(),
      },
      memory: {
        total: os.totalmem(),
        used: os.totalmem() - os.freemem(),
        free: os.freemem(),
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
      },
      uptime: process.uptime(),
      botLatency: process.hrtime(startTime)[1] / 1000000, // Convert to ms
      connectedChannels: 0, // Will be updated by bot
      lastUpdate: Date.now(),
    };

    this.emit('metrics', this.metrics);
    // Persist a simplified metric row to the metrics DB (fire-and-forget)
    metricsDbReady.then(() => {
      try {
        PerformanceMetric.create({
          timestamp: new Date(this.metrics.lastUpdate),
          cpuUsage: this.metrics.cpu.usage,
          loadAvg: JSON.stringify(this.metrics.cpu.loadAvg || []),
          memoryTotal: this.metrics.memory.total,
          memoryUsed: this.metrics.memory.used,
          heapUsed: this.metrics.memory.heapUsed,
          heapTotal: this.metrics.memory.heapTotal,
          botLatencyMs: this.metrics.botLatency,
          connectedChannels: this.metrics.connectedChannels || 0,
          extra: null
        }).catch(err => {
          logger.error('[metrics-db] Failed to save performance metric:', err);
        });
      } catch (err) {
        logger.error('[metrics-db] Unexpected error saving metric:', err);
      }
    }).catch(() => {/* ignore ready error */ });
  }

  public getMetrics(): PerformanceMetrics {
    return this.metrics;
  }

  public setConnectedChannels(count: number) {
    this.metrics.connectedChannels = count;
  }

  public stop() {
    clearInterval(this.updateInterval);
  }
}

export const performanceMonitor = new PerformanceMonitor();