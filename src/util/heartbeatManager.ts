import logger from './logger';

interface HeartbeatClient {
  id: string;
  lastActivity: number;
  onHeartbeat: () => void;
  onTimeout: () => void;
  heartbeatInterval: number;
  timeoutThreshold: number;
}

/**
 * Centralized Heartbeat Manager
 * Manages heartbeats for all IRC connections using a single interval
 * Reduces memory overhead from having one setInterval per connection
 */
class HeartbeatManager {
  private clients = new Map<string, HeartbeatClient>();
  private timer: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL = 30_000; // Check every 30 seconds instead of per-client

  /**
   * Register a client for heartbeat monitoring
   */
  register(client: HeartbeatClient): void {
    this.clients.set(client.id, client);
    logger.debug(`[HeartbeatManager] Registered ${client.id}, total clients: ${this.clients.size}`);

    // Start the timer if this is the first client
    if (this.clients.size === 1 && !this.timer) {
      this.start();
    }
  }

  /**
   * Unregister a client
   */
  unregister(id: string): void {
    this.clients.delete(id);
    logger.debug(`[HeartbeatManager] Unregistered ${id}, remaining clients: ${this.clients.size}`);

    // Stop the timer if no clients remain
    if (this.clients.size === 0 && this.timer) {
      this.stop();
    }
  }

  /**
   * Update last activity timestamp for a client
   */
  updateActivity(id: string): void {
    const client = this.clients.get(id);
    if (client) {
      client.lastActivity = Date.now();
    }
  }

  /**
   * Start the centralized heartbeat timer
   */
  private start(): void {
    if (this.timer) return;

    logger.info('[HeartbeatManager] Starting centralized heartbeat manager');
    
    this.timer = setInterval(() => {
      const now = Date.now();

      for (const [id, client] of this.clients) {
        // Check if client needs a heartbeat
        const timeSinceLastHeartbeat = now - client.lastActivity;
        
        if (timeSinceLastHeartbeat >= client.heartbeatInterval) {
          try {
            client.onHeartbeat();
            // Don't update lastActivity here - let the response update it
          } catch (err) {
            logger.error(`[HeartbeatManager] Heartbeat failed for ${id}:`, err);
          }
        }

        // Check for timeout
        if (timeSinceLastHeartbeat >= client.timeoutThreshold) {
          logger.warn(`[HeartbeatManager] Client ${id} timed out (${Math.floor(timeSinceLastHeartbeat / 1000)}s since last activity)`);
          try {
            client.onTimeout();
            this.unregister(id);
          } catch (err) {
            logger.error(`[HeartbeatManager] Timeout handler failed for ${id}:`, err);
          }
        }
      }
    }, this.CHECK_INTERVAL);
  }

  /**
   * Stop the centralized heartbeat timer
   */
  private stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('[HeartbeatManager] Stopped centralized heartbeat manager');
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      activeClients: this.clients.size,
      isRunning: this.timer !== null,
      checkInterval: this.CHECK_INTERVAL
    };
  }

  /**
   * Clear all clients (for testing/cleanup)
   */
  clear(): void {
    this.clients.clear();
    this.stop();
  }
}

// Export singleton instance
export const heartbeatManager = new HeartbeatManager();

// Log stats every 5 minutes
setInterval(() => {
  const stats = heartbeatManager.getStats();
  if (stats.activeClients > 0) {
    logger.info(`[HeartbeatManager] Active clients: ${stats.activeClients}`);
  }
}, 5 * 60 * 1000);
