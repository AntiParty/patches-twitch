#!/usr/bin/env ts-node
/**
 * One-time cleanup script to remove old metrics data
 * This will immediately clean up the 1M+ performance metric rows
 */

import { sequelizeMetrics, PerformanceMetric, RequestMetric, IGNVisit } from '../src/dbMetrics';
import { Op } from 'sequelize';
import logger from '../src/util/logger';

async function cleanupMetrics() {
  console.log('=== METRICS CLEANUP SCRIPT ===\n');
  
  try {
    await sequelizeMetrics.authenticate();
    console.log('✓ Connected to metrics database\n');

    // Count current rows
    const perfCount = await PerformanceMetric.count();
    const reqCount = await RequestMetric.count();
    const ignCount = await IGNVisit.count();

    console.log('Current row counts:');
    console.log(`  PerformanceMetrics: ${perfCount.toLocaleString()}`);
    console.log(`  RequestMetrics: ${reqCount.toLocaleString()}`);
    console.log(`  IGNVisits: ${ignCount.toLocaleString()}\n`);

    // Calculate cutoff dates
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    console.log('Cleanup cutoff dates:');
    console.log(`  RequestMetrics: Keep after ${thirtyDaysAgo.toISOString()} (30 days)`);
    console.log(`  PerformanceMetrics: Keep after ${sevenDaysAgo.toISOString()} (7 days)`);
    console.log(`  IGNVisits: Keep after ${threeDaysAgo.toISOString()} (3 days)\n`);

    // Delete old data
    console.log('Deleting old data...');
    
    const deletedRequests = await RequestMetric.destroy({
      where: { timestamp: { [Op.lt]: thirtyDaysAgo } }
    });
    console.log(`✓ Deleted ${deletedRequests.toLocaleString()} old RequestMetrics`);

    const deletedPerf = await PerformanceMetric.destroy({
      where: { timestamp: { [Op.lt]: sevenDaysAgo } }
    });
    console.log(`✓ Deleted ${deletedPerf.toLocaleString()} old PerformanceMetrics`);

    const deletedIGN = await IGNVisit.destroy({
      where: { timestamp: { [Op.lt]: threeDaysAgo } }
    });
    console.log(`✓ Deleted ${deletedIGN.toLocaleString()} old IGNVisits\n`);

    // Run VACUUM to reclaim disk space
    console.log('Running VACUUM to reclaim disk space...');
    await sequelizeMetrics.query('VACUUM;');
    console.log('✓ VACUUM complete\n');

    // Show new counts
    const newPerfCount = await PerformanceMetric.count();
    const newReqCount = await RequestMetric.count();
    const newIgnCount = await IGNVisit.count();

    console.log('New row counts:');
    console.log(`  PerformanceMetrics: ${newPerfCount.toLocaleString()} (reduced by ${(perfCount - newPerfCount).toLocaleString()})`);
    console.log(`  RequestMetrics: ${newReqCount.toLocaleString()} (reduced by ${(reqCount - newReqCount).toLocaleString()})`);
    console.log(`  IGNVisits: ${newIgnCount.toLocaleString()} (reduced by ${(ignCount - newIgnCount).toLocaleString()})\n`);

    console.log('✓ Cleanup complete!');
    
  } catch (error) {
    console.error('✗ Error during cleanup:', error);
    process.exit(1);
  } finally {
    await sequelizeMetrics.close();
  }
}

// Run cleanup
cleanupMetrics()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
