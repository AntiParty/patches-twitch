import fs from "fs/promises";
import path from "path";
import logger from "./logger";

interface CacheEntry {
  data: any;
  lastAccess: number;
  size: number;
}

/**
 * LRU Cache Manager for leaderboard data
 * Keeps only frequently accessed data in memory to reduce RAM usage
 */
class CacheManager {
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;
  private currentSize = 0;
  private cacheDir: string;

  // Statistics
  private hits = 0;
  private misses = 0;

  constructor(maxSizeMB: number = 10) {
    this.maxSize = maxSizeMB * 1024 * 1024; // Convert MB to bytes
    this.cacheDir = path.resolve(__dirname, "../../cache");

    // Log cache statistics every 5 minutes
    setInterval(() => this.logStats(), 5 * 60 * 1000);
  }

  /**
   * Get data from cache or load from disk
   */
  async get(key: string): Promise<any> {
    // Check cache first
    if (this.cache.has(key)) {
      const entry = this.cache.get(key)!;
      entry.lastAccess = Date.now();
      this.hits++;
      logger.debug(`[CacheManager] Cache HIT for ${key}`);
      return entry.data;
    }

    // Cache miss - load from disk
    this.misses++;
    logger.debug(`[CacheManager] Cache MISS for ${key}, loading from disk`);

    const data = await this.loadFromDisk(key);
    if (data === null) {
      return null;
    }

    const size = this.estimateSize(data);

    // Evict old entries if needed
    while (this.currentSize + size > this.maxSize && this.cache.size > 0) {
      this.evictLRU();
    }

    // Add to cache
    this.cache.set(key, {
      data,
      lastAccess: Date.now(),
      size,
    });
    this.currentSize += size;

    logger.debug(
      `[CacheManager] Cached ${key} (${(size / 1024 / 1024).toFixed(2)} MB), total: ${(this.currentSize / 1024 / 1024).toFixed(2)} MB`,
    );

    return data;
  }

  /**
   * Load data from disk
   */
  private async loadFromDisk(key: string): Promise<any> {
    try {
      const filePath = path.join(this.cacheDir, `${key}.json`);
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch (err) {
      logger.error(`[CacheManager] Failed to load ${key}:`, err);
      return null;
    }
  }

  /**
   * Estimate memory size of data without creating full JSON string
   * Uses a recursive sampling approach to avoid memory spikes
   */
  private estimateSize(data: any): number {
    return this.estimateSizeRecursive(data, 0, 5);
  }

  /**
   * Recursively estimate size with depth limit to prevent stack overflow
   * and sampling to avoid traversing huge arrays entirely
   */
  private estimateSizeRecursive(data: any, depth: number, maxDepth: number): number {
    if (data === null || data === undefined) return 8;
    if (depth > maxDepth) return 100; // Estimate for deeply nested objects

    const type = typeof data;

    if (type === 'string') {
      return data.length * 2 + 24; // String overhead
    }
    if (type === 'number') return 16;
    if (type === 'boolean') return 8;

    if (Array.isArray(data)) {
      // Sample array for large datasets to avoid traversing everything
      const sampleSize = Math.min(data.length, 100);
      let sampleTotal = 0;
      for (let i = 0; i < sampleSize; i++) {
        const idx = Math.floor((i / sampleSize) * data.length);
        sampleTotal += this.estimateSizeRecursive(data[idx], depth + 1, maxDepth);
      }
      // Extrapolate from sample
      const avgItemSize = sampleTotal / sampleSize;
      return data.length * avgItemSize + 32; // Array overhead
    }

    if (type === 'object') {
      const keys = Object.keys(data);
      let total = 32; // Object overhead
      const sampleSize = Math.min(keys.length, 20);
      for (let i = 0; i < sampleSize; i++) {
        const key = keys[i];
        total += key.length * 2 + 24; // Key string
        total += this.estimateSizeRecursive(data[key], depth + 1, maxDepth);
      }
      if (keys.length > sampleSize) {
        total = (total / sampleSize) * keys.length;
      }
      return total;
    }

    return 16; // Default estimate
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    let oldest: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.lastAccess < oldestTime) {
        oldest = key;
        oldestTime = entry.lastAccess;
      }
    }

    if (oldest) {
      const entry = this.cache.get(oldest)!;
      this.currentSize -= entry.size;
      this.cache.delete(oldest);
      logger.debug(
        `[CacheManager] Evicted ${oldest} (${(entry.size / 1024 / 1024).toFixed(2)} MB)`,
      );
    }
  }

  /**
   * Get latest cache file for a prefix (e.g., "regular_s" or "worldTour_s")
   */
  async getLatestFile(prefix: string): Promise<string | null> {
    try {
      const files = await fs.readdir(this.cacheDir);
      const matched = files
        .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
        .map((f) => {
          const num = parseInt(f.match(/\d+/)?.[0] ?? "0", 10);
          return { file: f, season: num };
        })
        .filter((x) => x.season > 0)
        .sort((a, b) => b.season - a.season); // newest first

      return matched.length > 0 ? matched[0].file.replace(".json", "") : null;
    } catch (err) {
      logger.error(
        `[CacheManager] Failed to list cache files for ${prefix}:`,
        err,
      );
      return null;
    }
  }

  /**
   * Get latest leaderboard data
   */
  async getLatestLeaderboard(): Promise<any> {
    const key = await this.getLatestFile("regular_s");
    return key ? this.get(key) : null;
  }

  /**
   * Get latest World Tour data
   */
  async getLatestWorldTour(): Promise<any> {
    const key = await this.getLatestFile("worldTour_s");
    return key ? this.get(key) : null;
  }

  /**
   * Get specific season data
   */
  async getSeasonData(
    type: "regular" | "worldTour",
    season: number,
  ): Promise<any> {
    const key =
      type === "regular" ? `regular_s${season}` : `worldTour_s${season}`;
    return this.get(key);
  }

  /**
   * Clear all cached data
   */
  clear(): void {
    this.cache.clear();
    this.currentSize = 0;
    logger.info("[CacheManager] Cache cleared");
  }

  /**
   * Invalidate specific key or all keys from memory cache
   * This forces the next access to reload from disk
   */
  invalidate(key?: string): void {
    if (key) {
      if (this.cache.has(key)) {
        const entry = this.cache.get(key)!;
        this.currentSize -= entry.size;
        this.cache.delete(key);
        logger.debug(`[CacheManager] Invalidated ${key}`);
      }
    } else {
      // Invalidate all
      this.cache.clear();
      this.currentSize = 0;
      logger.debug("[CacheManager] Invalidated all cache entries");
    }
  }

  /**
   * Invalidate and immediately reload from disk
   * Returns the fresh data
   */
  async refresh(key: string): Promise<any> {
    this.invalidate(key);
    return this.get(key);
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const hitRate =
      this.hits + this.misses > 0
        ? ((this.hits / (this.hits + this.misses)) * 100).toFixed(2)
        : "0.00";

    return {
      entries: this.cache.size,
      sizeMB: (this.currentSize / 1024 / 1024).toFixed(2),
      maxSizeMB: (this.maxSize / 1024 / 1024).toFixed(2),
      hits: this.hits,
      misses: this.misses,
      hitRate: `${hitRate}%`,
    };
  }

  /**
   * Log cache statistics
   */
  private logStats(): void {
    const stats = this.getStats();
    if (this.hits + this.misses > 0) {
      logger.info(
        `[CacheManager] Stats: ${stats.entries} entries, ${stats.sizeMB}/${stats.maxSizeMB} MB, Hit rate: ${stats.hitRate}`,
      );
    }
  }

  /**
   * Preload current season data (optional optimization)
   */
  async preloadCurrentSeason(): Promise<void> {
    logger.info("[CacheManager] Preloading current season data...");
    await Promise.all([this.getLatestLeaderboard(), this.getLatestWorldTour()]);
    logger.info("[CacheManager] Preload complete");
  }
}

// Export singleton instance
export const cacheManager = new CacheManager(10); // 10MB max cache size

// Preload current season on startup (optional)
cacheManager.preloadCurrentSeason().catch((err) => {
  logger.error("[CacheManager] Failed to preload:", err);
});
