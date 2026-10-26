import { Channel, TrollChannel, TrollResponse } from '@/db';
import { resolveViewerCommandName } from './channelCommandSettings.service';
import logger from '@/util/logger';

export const ANY_COMMAND = '*';
export const TROLL_PLACEHOLDERS = ['user', 'channel', 'ign', 'command', 'percent'] as const;

const CHANNEL_COOLDOWN_MS = 60_000;
const CACHE_TTL_MS = 30_000;

export interface TrollCandidate {
  id: number;
  command: string;
  channel: string | null;
  response: string;
  chance: number;
  follow_up: boolean;
}

export interface TrollHit {
  id: number;
  text: string;
  followUp: boolean;
}

export function normalizeTrollCommand(command: string): string {
  const normalized = command.replace(/^!/, '').trim().toLowerCase();
  if (normalized === ANY_COMMAND) return ANY_COMMAND;
  return resolveViewerCommandName(normalized) ?? normalized;
}

export function clampChance(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 5;
  return Math.min(Math.max(Math.round(n * 10) / 10, 0.1), 100);
}

/**
 * One roll across every matching troll: each gets a slice of [0, 100) equal to
 * its chance, so a 5% troll fires ~5% of the time regardless of how many exist.
 */
export function pickTroll(
  trolls: TrollCandidate[],
  channel: string,
  command: string,
  rand: () => number = Math.random,
): TrollCandidate | null {
  const resolved = normalizeTrollCommand(command);
  const matching = trolls.filter(
    (t) =>
      (t.channel === null || t.channel === channel) &&
      (t.command === ANY_COMMAND || t.command === resolved),
  );
  if (matching.length === 0) return null;

  const roll = rand() * 100;
  let edge = 0;
  for (const troll of matching) {
    edge += troll.chance;
    if (roll < edge) return troll;
  }
  return null;
}

export function formatTroll(template: string, vars: Partial<Record<typeof TROLL_PLACEHOLDERS[number], string>>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? (vars as any)[key] ?? '' : match));
}

let cache: { at: number; trolls: TrollCandidate[]; armed: Set<string> } | null = null;
const lastTrollAt = new Map<string, number>();

async function loadTrolls() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache;
  const [rows, armedRows] = await Promise.all([
    TrollResponse.findAll({ where: { enabled: true } }),
    TrollChannel.findAll({ attributes: ['channel'] }),
  ]);
  cache = {
    at: Date.now(),
    trolls: rows.map((row) => ({
      id: row.id,
      command: row.command,
      channel: row.channel,
      response: row.response,
      chance: Number(row.chance),
      follow_up: Boolean(row.follow_up),
    })),
    armed: new Set(armedRows.map((row) => row.channel)),
  };
  return cache;
}

/** Bot process: called before a command runs. Returns a troll to send instead (or before) it. */
export async function rollTroll(channel: string, command: string, user: string): Promise<TrollHit | null> {
  try {
    const { trolls, armed } = await loadTrolls();
    if (!armed.has(channel)) return null;
    if (Date.now() - (lastTrollAt.get(channel) ?? 0) < CHANNEL_COOLDOWN_MS) return null;

    const troll = pickTroll(trolls, channel, command);
    if (!troll) return null;
    lastTrollAt.set(channel, Date.now());

    const channelRow = await Channel.findOne({ where: { username: channel }, attributes: ['player_id'] });
    const text = formatTroll(troll.response, {
      user,
      channel,
      ign: channelRow?.player_id?.split('#')[0] || channel,
      command: `!${command.replace(/^!/, '')}`,
      percent: String(Math.floor(Math.random() * 101)),
    });
    logger.info(`[troll] Troll #${troll.id} fired on !${command} in #${channel}`);
    return { id: troll.id, text, followUp: troll.follow_up };
  } catch (err) {
    logger.error('[troll] Failed to roll troll; running command normally:', err);
    return null;
  }
}
