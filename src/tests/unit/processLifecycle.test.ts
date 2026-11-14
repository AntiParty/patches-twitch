import assert from 'assert';
import { createProcessLifecycle, parseShutdownTimeoutMs } from '../../util/processLifecycle';

function harness(overrides: { timeoutMs?: number } = {}) {
  const handlers: Record<string, (...args: any[]) => void> = {};
  const exits: number[] = [];
  const logs: Array<{ level: string; message: string }> = [];
  const proc = {
    on: (event: string, listener: (...args: any[]) => void) => {
      handlers[event] = listener;
    },
    exit: (code?: number) => {
      exits.push(code ?? 0);
    },
  };
  const log = {
    info: (message: string) => logs.push({ level: 'info', message }),
    warn: (message: string) => logs.push({ level: 'warn', message }),
    error: (message: string) => logs.push({ level: 'error', message }),
  };
  const lifecycle = createProcessLifecycle({
    proc,
    log,
    getTimeoutMs: () => overrides.timeoutMs ?? 1000,
    endLogger: async () => {},
  });
  const waitForExit = async () => {
    for (let i = 0; i < 200 && exits.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
  };
  return { handlers, exits, logs, lifecycle, waitForExit };
}

describe('processLifecycle', () => {
  it('runs hooks in reverse registration order, then exits 0', async () => {
    const h = harness();
    const order: string[] = [];
    h.lifecycle.onShutdown('first', () => void order.push('first'));
    h.lifecycle.onShutdown('second', async () => {
      order.push('second');
    });
    h.lifecycle.onShutdown('third', () => void order.push('third'));
    h.lifecycle.installShutdownHandlers();

    h.handlers.SIGTERM();
    await h.waitForExit();

    assert.deepStrictEqual(order, ['third', 'second', 'first']);
    assert.deepStrictEqual(h.exits, [0]);
    assert.ok(h.logs.some((l) => l.message === '[Process] SIGTERM received, shutting down'));
  });

  it('keeps running the other hooks when one throws', async () => {
    const h = harness();
    const ran: string[] = [];
    h.lifecycle.onShutdown('last-to-run', () => void ran.push('a'));
    h.lifecycle.onShutdown('bad', () => {
      throw new Error('boom');
    });
    h.lifecycle.onShutdown('bad-async', async () => {
      throw new Error('boom async');
    });
    h.lifecycle.onShutdown('first-to-run', () => void ran.push('b'));
    h.lifecycle.installShutdownHandlers();

    h.handlers.SIGINT();
    await h.waitForExit();

    assert.deepStrictEqual(ran, ['b', 'a']);
    assert.strictEqual(h.logs.filter((l) => l.level === 'error').length, 2);
    assert.deepStrictEqual(h.exits, [0]);
  });

  it('exits at the deadline when a hook hangs', async () => {
    const h = harness({ timeoutMs: 50 });
    h.lifecycle.onShutdown('hangs', () => new Promise<void>(() => {}));
    h.lifecycle.installShutdownHandlers();

    const started = Date.now();
    h.handlers.SIGINT();
    await h.waitForExit();

    assert.deepStrictEqual(h.exits, [0]);
    assert.ok(Date.now() - started < 800, 'exit must not wait for the hung hook');
    assert.ok(h.logs.some((l) => l.level === 'warn' && l.message.includes('deadline')));
  });

  it('is idempotent: installing twice registers one listener and hooks run once', async () => {
    let registrations = 0;
    const exits: number[] = [];
    const lifecycle = createProcessLifecycle({
      proc: {
        on: () => {
          registrations++;
        },
        exit: (code) => {
          exits.push(code ?? 0);
        },
      },
      log: { info() {}, warn() {}, error() {} },
      endLogger: async () => {},
    });
    lifecycle.installShutdownHandlers();
    lifecycle.installShutdownHandlers();
    lifecycle.installCrashHandlers();
    lifecycle.installCrashHandlers();
    assert.strictEqual(registrations, 2 + 2); // SIGINT + SIGTERM, unhandledRejection + uncaughtException

    let runs = 0;
    lifecycle.onShutdown('once', () => void runs++);
    await Promise.all([lifecycle.shutdown(0), lifecycle.shutdown(0)]);
    assert.strictEqual(runs, 1);
    assert.deepStrictEqual(exits, [0]);
  });

  it('exits immediately on a second signal while shutting down', async () => {
    const h = harness({ timeoutMs: 5000 });
    h.lifecycle.onShutdown('hangs', () => new Promise<void>(() => {}));
    h.lifecycle.installShutdownHandlers();

    h.handlers.SIGINT();
    assert.deepStrictEqual(h.exits, []);
    h.handlers.SIGINT();
    assert.deepStrictEqual(h.exits, [0]);
  });

  it('unhandledRejection logs and does not exit', async () => {
    const h = harness();
    h.lifecycle.installCrashHandlers();

    h.handlers.unhandledRejection(new Error('nope'));
    await new Promise((r) => setTimeout(r, 20));

    assert.deepStrictEqual(h.exits, []);
    assert.ok(h.logs.some((l) => l.level === 'error' && l.message === '[Process] Unhandled promise rejection:'));
  });

  it('uncaughtException logs, runs hooks and exits 1', async () => {
    const h = harness();
    let ran = false;
    h.lifecycle.onShutdown('hook', () => void (ran = true));
    h.lifecycle.installCrashHandlers();

    h.handlers.uncaughtException(new Error('fatal'));
    await h.waitForExit();

    assert.ok(ran);
    assert.deepStrictEqual(h.exits, [1]);
    assert.ok(h.logs.some((l) => l.message === '[Process] Uncaught exception:'));
  });

  it('parses SHUTDOWN_TIMEOUT_MS with a 1200ms default', () => {
    assert.strictEqual(parseShutdownTimeoutMs(undefined), 1200);
    assert.strictEqual(parseShutdownTimeoutMs(''), 1200);
    assert.strictEqual(parseShutdownTimeoutMs('abc'), 1200);
    assert.strictEqual(parseShutdownTimeoutMs('500'), 500);
  });
});
