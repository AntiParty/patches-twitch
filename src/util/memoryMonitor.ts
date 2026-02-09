/**
 * Memory Monitor Utility
 * Tracks memory usage and triggers warnings when approaching limits
 * Helps identify memory leaks by logging usage patterns over time
 */
import logger from './logger';

interface MemorySnapshot {
  timestamp: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
}

class MemoryMonitor {
  private snapshots: MemorySnapshot[] = [];
  private maxSnapshots = 60; // Keep 1 hour of minute-by-minute data
  private warningThresholdMB = 1024; // 1GB warning threshold
  private criticalThresholdMB = 1536; // 1.5GB critical threshold (leaving buffer for 2GB)
  private intervalId: NodeJS.Timeout | null = null;

  /**
   * Start monitoring memory usage
   * @param intervalMs How often to check memory (default: 60 seconds)
   */
  start(intervalMs = 60_000): void {
    if (this.intervalId) {
      logger.warn('[MemoryMonitor] Already running');
      return;
    }

    logger.info('[MemoryMonitor] Starting memory monitoring');
    this.takeSnapshot(); // Initial snapshot

    this.intervalId = setInterval(() => {
      this.takeSnapshot();
      this.checkThresholds();
      this.logTrend();
    }, intervalMs);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('[MemoryMonitor] Stopped');
    }
  }

  /**
   * Take a memory snapshot
   */
  private takeSnapshot(): void {
    const mem = process.memoryUsage();
    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      rss: mem.rss,
    };

    this.snapshots.push(snapshot);

    // Keep only the last maxSnapshots
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }
  }

  /**
   * Check if memory usage exceeds thresholds
   */
  private checkThresholds(): void {
    const latest = this.snapshots[this.snapshots.length - 1];
    if (!latest) return;

    const heapUsedMB = latest.heapUsed / 1024 / 1024;
    const rssMB = latest.rss / 1024 / 1024;

    if (rssMB >= this.criticalThresholdMB) {
      logger.error(`[MemoryMonitor] CRITICAL: Memory usage at ${rssMB.toFixed(0)}MB (heap: ${heapUsedMB.toFixed(0)}MB) - approaching system limit!`);
      this.triggerGC();
    } else if (rssMB >= this.warningThresholdMB) {
      logger.warn(`[MemoryMonitor] WARNING: Memory usage at ${rssMB.toFixed(0)}MB (heap: ${heapUsedMB.toFixed(0)}MB)`);
    }
  }

  /**
   * Log memory trend (called every interval)
   */
  private logTrend(): void {
    if (this.snapshots.length < 2) return;

    const latest = this.snapshots[this.snapshots.length - 1];
    const oldest = this.snapshots[0];

    const heapGrowthMB = (latest.heapUsed - oldest.heapUsed) / 1024 / 1024;
    const rssGrowthMB = (latest.rss - oldest.rss) / 1024 / 1024;
    const timeSpanMin = (latest.timestamp - oldest.timestamp) / 1000 / 60;

    // Only log if there's significant growth (more than 50MB in the tracking period)
    if (Math.abs(heapGrowthMB) > 50 || Math.abs(rssGrowthMB) > 50) {
      logger.info(
        `[MemoryMonitor] Trend (${timeSpanMin.toFixed(0)}min): Heap ${heapGrowthMB >= 0 ? '+' : ''}${heapGrowthMB.toFixed(0)}MB, RSS ${rssGrowthMB >= 0 ? '+' : ''}${rssGrowthMB.toFixed(0)}MB`
      );
    }

    // Log current usage every 5 minutes
    if (this.snapshots.length % 5 === 0) {
      const heapUsedMB = latest.heapUsed / 1024 / 1024;
      const rssMB = latest.rss / 1024 / 1024;
      logger.info(`[MemoryMonitor] Current: Heap ${heapUsedMB.toFixed(0)}MB, RSS ${rssMB.toFixed(0)}MB`);
    }
  }

  /**
   * Attempt to trigger garbage collection if exposed
   */
  private triggerGC(): void {
    if (global.gc) {
      logger.info('[MemoryMonitor] Triggering manual garbage collection');
      global.gc();
    } else {
      logger.debug('[MemoryMonitor] Manual GC not available (run with --expose-gc)');
    }
  }

  /**
   * Get current memory statistics
   */
  getStats(): {
    current: { heapMB: number; rssMB: number };
    trend: { heapGrowthMB: number; rssGrowthMB: number; periodMin: number } | null;
    snapshotCount: number;
  } {
    const latest = this.snapshots[this.snapshots.length - 1];
    const oldest = this.snapshots[0];

    if (!latest) {
      return {
        current: { heapMB: 0, rssMB: 0 },
        trend: null,
        snapshotCount: 0,
      };
    }

    const trend = oldest && this.snapshots.length >= 2
      ? {
          heapGrowthMB: (latest.heapUsed - oldest.heapUsed) / 1024 / 1024,
          rssGrowthMB: (latest.rss - oldest.rss) / 1024 / 1024,
          periodMin: (latest.timestamp - oldest.timestamp) / 1000 / 60,
        }
      : null;

    return {
      current: {
        heapMB: latest.heapUsed / 1024 / 1024,
        rssMB: latest.rss / 1024 / 1024,
      },
      trend,
      snapshotCount: this.snapshots.length,
    };
  }

  /**
   * Force a garbage collection and return memory freed
   */
  forceGC(): { beforeMB: number; afterMB: number; freedMB: number } | null {
    if (!global.gc) {
      return null;
    }

    const before = process.memoryUsage().heapUsed;
    global.gc();
    const after = process.memoryUsage().heapUsed;

    const result = {
      beforeMB: before / 1024 / 1024,
      afterMB: after / 1024 / 1024,
      freedMB: (before - after) / 1024 / 1024,
    };

    logger.info(`[MemoryMonitor] GC freed ${result.freedMB.toFixed(1)}MB (${result.beforeMB.toFixed(0)}MB -> ${result.afterMB.toFixed(0)}MB)`);
    return result;
  }
}

// Export singleton instance
export const memoryMonitor = new MemoryMonitor();

// Auto-start monitoring
memoryMonitor.start();
