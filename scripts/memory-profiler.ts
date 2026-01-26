import v8 from 'v8';
import fs from 'fs';
import path from 'path';
import logger from '../src/util/logger';

interface MemoryProfile {
  timestamp: string;
  process: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    arrayBuffers: number;
    rss: number;
  };
  system: {
    totalMem: number;
    freeMem: number;
    usedMem: number;
  };
  eventListeners: {
    [key: string]: number;
  };
  timers: {
    active: number;
  };
}

/**
 * Memory profiling utility to identify memory consumers
 */
export async function profileMemory(): Promise<MemoryProfile> {
  const mem = process.memoryUsage();
  const os = require('os');

  // Count event listeners (potential leak detection)
  const eventListenerCounts: { [key: string]: number } = {};
  try {
    const emitters = (process as any)._getActiveHandles?.() || [];
    for (const emitter of emitters) {
      if (emitter?.eventNames) {
        const names = emitter.eventNames();
        for (const name of names) {
          const count = emitter.listenerCount(name);
          eventListenerCounts[String(name)] = (eventListenerCounts[String(name)] || 0) + count;
        }
      }
    }
  } catch (err) {
    logger.warn('[MemoryProfiler] Could not count event listeners:', err);
  }

  // Count active timers
  const handles = (process as any)._getActiveHandles?.() || [];
  const activeTimers = handles.filter((h: any) => 
    h?.constructor?.name === 'Timeout' || h?.constructor?.name === 'Interval'
  ).length;

  const profile: MemoryProfile = {
    timestamp: new Date().toISOString(),
    process: {
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers,
      rss: mem.rss,
    },
    system: {
      totalMem: os.totalmem(),
      freeMem: os.freemem(),
      usedMem: os.totalmem() - os.freemem(),
    },
    eventListeners: eventListenerCounts,
    timers: {
      active: activeTimers,
    },
  };

  return profile;
}

/**
 * Generate and save a heap snapshot
 */
export function takeHeapSnapshot(filename?: string): string {
  const logsDir = path.resolve(__dirname, '../logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const snapshotName = filename || `heap-${Date.now()}.heapsnapshot`;
  const snapshotPath = path.join(logsDir, snapshotName);

  v8.writeHeapSnapshot(snapshotPath);
  logger.info(`[MemoryProfiler] Heap snapshot saved to ${snapshotPath}`);

  return snapshotPath;
}

/**
 * Format bytes to human-readable format
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Generate a memory report
 */
export async function generateMemoryReport(): Promise<string> {
  const profile = await profileMemory();
  
  const report = `
=== MEMORY PROFILE REPORT ===
Generated: ${profile.timestamp}

--- Process Memory ---
Heap Used:      ${formatBytes(profile.process.heapUsed)}
Heap Total:     ${formatBytes(profile.process.heapTotal)}
External:       ${formatBytes(profile.process.external)}
Array Buffers:  ${formatBytes(profile.process.arrayBuffers)}
RSS:            ${formatBytes(profile.process.rss)}

--- System Memory ---
Total:          ${formatBytes(profile.system.totalMem)}
Free:           ${formatBytes(profile.system.freeMem)}
Used:           ${formatBytes(profile.system.usedMem)}
Usage:          ${((profile.system.usedMem / profile.system.totalMem) * 100).toFixed(2)}%

--- Event Listeners ---
${Object.entries(profile.eventListeners)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .map(([name, count]) => `${name}: ${count}`)
  .join('\n') || 'None detected'}

--- Timers ---
Active Timers:  ${profile.timers.active}

--- Recommendations ---
${profile.process.heapUsed > 200 * 1024 * 1024 ? '⚠️  Heap usage is high (>200MB)' : '✓ Heap usage is normal'}
${profile.timers.active > 20 ? '⚠️  High number of active timers detected' : '✓ Timer count is normal'}
${Object.values(profile.eventListeners).some(c => c > 50) ? '⚠️  Some event listeners have high counts (potential leak)' : '✓ Event listener counts are normal'}
`;

  return report;
}

// CLI usage
if (require.main === module) {
  (async () => {
    console.log('Generating memory profile...\n');
    const report = await generateMemoryReport();
    console.log(report);
    
    console.log('\nTaking heap snapshot...');
    const snapshotPath = takeHeapSnapshot();
    console.log(`Snapshot saved to: ${snapshotPath}`);
    
    // Save report to file
    const logsDir = path.resolve(__dirname, '../logs');
    const reportPath = path.join(logsDir, `memory-report-${Date.now()}.txt`);
    fs.writeFileSync(reportPath, report);
    console.log(`Report saved to: ${reportPath}`);
  })();
}
