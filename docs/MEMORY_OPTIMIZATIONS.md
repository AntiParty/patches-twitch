# Memory & Performance Optimizations

This document details the performance improvements made to reduce RAM usage and database bloat.

## Summary of Changes

1.  **Optimized Performance Monitor**
    - Reduced database write frequency from **5 seconds** to **30 seconds**.
    - Reduces writes from ~17,280/day to ~2,880/day (83% reduction).
    - Significantly lowers disk I/O and CPU usage.

2.  **Aggressive Metrics Cleanup**
    - **Performance Metrics**: Retention reduced from 30 days to **7 days** (these are high-frequency logs).
    - **Request Metrics**: Retention pushed to 30 days.
    - **IGN Visits**: Retention reduced to 3 days.
    - **Cleanup Frequency**: Runs on **startup** and every **6 hours** (previously daily).
    - **Auto-Vacuum**: Automatically runs `VACUUM` if many rows are deleted to reclaim disk space.

3.  **Database Connection Pool**
    - Reduced max concurrent connections from 5 to **3**.
    - Reduced idle connection timeout from 10s to **5s** to free up memory faster.

## New Utility Scripts

### 1. Memory Profiler

View detailed memory usage and generate heap snapshots.

```bash
# Run the profiler
ts-node scripts/memory-profiler.ts
```

**Output:**

- Console report of Heap, RSS, and External memory.
- Active timer and event listener counts.
- Generates a heap snapshot file in `logs/` directory (can be opened in Chrome DevTools).

### 2. Manual Metrics Cleanup

Immediately clean up old metrics data to free up disk space and improve query performance.

```bash
# Run manual cleanup
ts-node scripts/cleanup-metrics.ts
```

## Dashboard Impact

- The Real-time dashboard (`/admin`) will now update performance graphs every 30 seconds instead of 5 seconds. This is intended behavior to save resources.
- Historic data for CPU/Memory will only be available for the last 7 days.
