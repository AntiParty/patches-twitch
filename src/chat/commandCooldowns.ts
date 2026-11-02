/**
 * Per-channel command cooldowns: one window per command (any user) and one per user per command.
 * Broadcasters, mods and VIPs skip both. Commands can override the defaults by exporting
 * `cooldown = { userMs, globalMs }`; 0 turns a window off.
 */

export interface CooldownSpec {
  userMs?: number;
  globalMs?: number;
}

// No global window by default: most commands answer about the caller, so other viewers must not be blocked.
export const DEFAULT_COOLDOWN: Required<CooldownSpec> = { userMs: 10_000, globalMs: 0 };
const SWEEP_EVERY = 500;

export function createCommandCooldowns(now: () => number = Date.now) {
  const until = new Map<string, number>();
  let checks = 0;

  function sweep(t: number) {
    for (const [k, v] of until) if (v <= t) until.delete(k);
  }

  return {
    /** Returns true and starts the cooldowns when the command may run; false while it is cooling down. */
    tryUse(channel: string, commandKey: string, userId: string, spec: CooldownSpec = {}): boolean {
      const t = now();
      if (++checks % SWEEP_EVERY === 0) sweep(t);
      const userMs = spec.userMs ?? DEFAULT_COOLDOWN.userMs;
      const globalMs = spec.globalMs ?? DEFAULT_COOLDOWN.globalMs;
      const globalKey = `${channel}|${commandKey}`;
      const userKey = `${globalKey}|${userId}`;
      if ((until.get(globalKey) ?? 0) > t || (until.get(userKey) ?? 0) > t) return false;
      if (globalMs > 0) until.set(globalKey, t + globalMs);
      if (userMs > 0) until.set(userKey, t + userMs);
      return true;
    },
    size: () => until.size,
  };
}

export type CommandCooldowns = ReturnType<typeof createCommandCooldowns>;
