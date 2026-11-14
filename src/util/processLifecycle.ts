import logger from './logger';

/**
 * Process lifecycle: crash handlers and an ordered, time-bounded shutdown.
 *
 * pm2 sends SIGINT and force-kills after ~1.6s, so shutdown has to finish (and
 * actually exit) well inside that window. Listeners that only clear a timer and
 * never exit keep the process alive until the SIGKILL, so every cleanup goes
 * through `onShutdown` and this module owns the single `process.exit`.
 */

export type ShutdownHook = () => void | Promise<void>;

export interface ProcessLike {
  on(event: string, listener: (...args: any[]) => void): unknown;
  exit(code?: number): unknown;
}

export interface LifecycleLog {
  info(message: string, ...meta: any[]): unknown;
  warn(message: string, ...meta: any[]): unknown;
  error(message: string, ...meta: any[]): unknown;
}

export interface ProcessLifecycleDeps {
  proc?: ProcessLike;
  log?: LifecycleLog;
  /** Overall shutdown deadline in ms. Evaluated when shutdown starts. */
  getTimeoutMs?: () => number;
  /** Flushes the logger. Bounded by `loggerFlushMs`; failures are ignored. */
  endLogger?: () => Promise<void>;
  loggerFlushMs?: number;
}

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 1200;
const DEFAULT_LOGGER_FLUSH_MS = 200;

export function parseShutdownTimeoutMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_SHUTDOWN_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SHUTDOWN_TIMEOUT_MS;
}

function defaultEndLogger(): Promise<void> {
  return new Promise<void>((resolve) => {
    const l: any = logger;
    if (typeof l.end !== 'function') return resolve();
    try {
      l.once?.('finish', () => resolve());
      l.end();
    } catch {
      resolve();
    }
  });
}

function sleep(ms: number): { promise: Promise<'timeout'>; cancel: () => void } {
  let handle: NodeJS.Timeout;
  const promise = new Promise<'timeout'>((resolve) => {
    handle = setTimeout(() => resolve('timeout'), ms);
  });
  return { promise, cancel: () => clearTimeout(handle) };
}

export function createProcessLifecycle(deps: ProcessLifecycleDeps = {}) {
  const proc: ProcessLike = deps.proc ?? (process as unknown as ProcessLike);
  const log: LifecycleLog = deps.log ?? logger;
  const getTimeoutMs = deps.getTimeoutMs ?? (() => parseShutdownTimeoutMs(process.env.SHUTDOWN_TIMEOUT_MS));
  const endLogger = deps.endLogger ?? defaultEndLogger;
  const loggerFlushMs = deps.loggerFlushMs ?? DEFAULT_LOGGER_FLUSH_MS;

  const hooks: Array<{ name: string; fn: ShutdownHook }> = [];
  let crashInstalled = false;
  let shutdownInstalled = false;
  let shuttingDown = false;

  function onShutdown(name: string, fn: ShutdownHook): void {
    hooks.push({ name, fn });
  }

  async function runHooks(): Promise<void> {
    for (const hook of [...hooks].reverse()) {
      try {
        await hook.fn();
      } catch (err) {
        log.error(`[Process] Shutdown hook "${hook.name}" failed:`, err);
      }
    }
  }

  /** Runs the shutdown sequence once; later calls resolve immediately. Always ends in exit. */
  async function shutdown(exitCode: number): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    const deadline = sleep(getTimeoutMs());
    try {
      const outcome = await Promise.race([runHooks().then(() => 'done' as const), deadline.promise]);
      if (outcome === 'timeout') log.warn('[Process] Shutdown deadline reached; exiting with hooks still running');
    } catch (err) {
      log.error('[Process] Shutdown sequence failed:', err);
    } finally {
      deadline.cancel();
    }

    const flush = sleep(loggerFlushMs);
    try {
      await Promise.race([endLogger().catch(() => undefined), flush.promise]);
    } catch {
      /* best effort */
    } finally {
      flush.cancel();
    }
    proc.exit(exitCode);
  }

  function installCrashHandlers(): void {
    if (crashInstalled) return;
    crashInstalled = true;

    proc.on('unhandledRejection', (reason: unknown) => {
      try {
        log.error('[Process] Unhandled promise rejection:', reason);
      } catch {
        /* a handler must never throw */
      }
    });

    proc.on('uncaughtException', (err: unknown) => {
      try {
        log.error('[Process] Uncaught exception:', err);
      } catch {
        /* a handler must never throw */
      }
      // Let pm2 restart us on a clean slate.
      shutdown(1).catch(() => {
        try {
          proc.exit(1);
        } catch {
          /* nothing left to do */
        }
      });
    });
  }

  function installShutdownHandlers(): void {
    if (shutdownInstalled) return;
    shutdownInstalled = true;

    const handle = (signal: string) => {
      try {
        if (shuttingDown) {
          proc.exit(0);
          return;
        }
        log.info(`[Process] ${signal} received, shutting down`);
        shutdown(0).catch(() => proc.exit(0));
      } catch {
        try {
          proc.exit(0);
        } catch {
          /* nothing left to do */
        }
      }
    };

    proc.on('SIGINT', () => handle('SIGINT'));
    proc.on('SIGTERM', () => handle('SIGTERM'));
  }

  return { onShutdown, installCrashHandlers, installShutdownHandlers, shutdown };
}

const lifecycle = createProcessLifecycle();

export const onShutdown = lifecycle.onShutdown;
export const installCrashHandlers = lifecycle.installCrashHandlers;
export const installShutdownHandlers = lifecycle.installShutdownHandlers;
