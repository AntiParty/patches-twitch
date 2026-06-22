/**
 * Channels where the bot stays silent (every command suppressed except the
 * !devmode/!dev toggle) so a locally-run dev bot can answer instead.
 *
 * Anchored on globalThis ON PURPOSE. The compiled bot (dist/*) imports this file
 * by relative path, but chat commands are loaded through the "@/..." alias, which
 * Bun resolves to the SOURCE file (src/util/devModeState.ts) because the build
 * (plain `tsc`) doesn't rewrite aliases. That makes this module evaluate twice —
 * one dist copy, one src copy — so a plain module-level Set would exist as two
 * separate instances: the command writes to one while the dispatcher reads the
 * other, and silencing silently never takes effect. A globalThis-backed Set is a
 * single shared instance per process regardless of how many times this loads.
 */
const g = globalThis as any;
export const devModeChannels: Set<string> =
  g.__patchesDevModeChannels ?? (g.__patchesDevModeChannels = new Set<string>());

// The toggle itself is always allowed through so dev mode can be turned back off.
const DEVMODE_EXEMPT_COMMANDS = new Set(["!devmode", "!dev"]);

/**
 * Whether a chat command should be suppressed because its channel is in dev mode.
 *
 * Silences ALL commands except the !devmode/!dev toggle whenever the channel is
 * flagged — independent of NODE_ENV. (A prior NODE_ENV gate meant the bot only
 * went silent when running as a production build, so a normally-run bot kept
 * answering despite dev mode being on.)
 */
export function isCommandSilenced(channelName: string, commandKey: string): boolean {
  if (!devModeChannels.has(channelName.toLowerCase())) return false;
  return !DEVMODE_EXEMPT_COMMANDS.has(commandKey.toLowerCase());
}
