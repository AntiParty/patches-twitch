/**
 * Giveaway service — the shared draw engine for both giveaway types.
 *
 * A giveaway is an ordered list of entry "slots". Drawing picks a
 * cryptographically-random slot; the user on that slot wins. Ticket entries and
 * redeem entries both become rows here, so more tickets/redeems == more chances.
 */
import crypto from 'crypto';
import { Op } from 'sequelize';
import { Giveaway, GiveawayEntry } from '../db';
import logger from '../util/logger';

/** Random integer in [0, n). Injectable so tests are deterministic. */
export type Rng = (n: number) => number;
const defaultRng: Rng = (n) => crypto.randomInt(0, n);

function normalizeChannel(channel: string): string {
  return channel.replace(/^#/, '').toLowerCase();
}

export interface CreateGiveawayInput {
  channel: string;
  type: 'ticket' | 'redeem';
  prize?: string | null;
  maxTicketsPerUser?: number;
  targetWinnerCount?: number;
  rewardCost?: number | null;
  maxPerUserPerStream?: number | null;
  maxPerStream?: number | null;
  cooldownSeconds?: number | null;
}

export interface GiveawayWinnerRecord {
  userId: string;
  username: string;
  slot: number;
}

export type CreateGiveawayResult =
  | { ok: true; giveaway: Giveaway }
  | { ok: false; reason: 'already_active' };

/** The channel's current giveaway (open or drawn), or null once closed. */
export async function getActiveGiveaway(channel: string): Promise<Giveaway | null> {
  return Giveaway.findOne({
    where: { channel: normalizeChannel(channel), status: { [Op.ne]: 'closed' } },
    order: [['id', 'DESC']],
  });
}

export async function createGiveaway(input: CreateGiveawayInput): Promise<CreateGiveawayResult> {
  const channel = normalizeChannel(input.channel);
  const existing = await getActiveGiveaway(channel);
  if (existing) return { ok: false, reason: 'already_active' };

  const giveaway = await Giveaway.create({
    channel,
    type: input.type,
    status: 'open',
    prize: input.prize ?? null,
    max_tickets_per_user: input.maxTicketsPerUser ?? 1,
    // 0 = unlimited respins (chat giveaways); N>0 = a fixed target (channel points).
    target_winner_count: Math.max(0, Math.floor(input.targetWinnerCount ?? 1)),
    winners_json: '[]',
    reward_cost: input.rewardCost ?? null,
    max_per_user_per_stream: input.maxPerUserPerStream ?? null,
    max_per_stream: input.maxPerStream ?? null,
    cooldown_seconds: input.cooldownSeconds ?? null,
    created_at: new Date(),
  });
  return { ok: true, giveaway };
}

export interface AddTicketInput {
  channel: string;
  userId: string;
  username: string;
}

export type AddTicketResult =
  | { ok: true }
  | { ok: false; reason: 'no_giveaway' | 'wrong_type' | 'paused' | 'locked' | 'already_entered' };

// One entry per person — everyone gets equal odds, no weighted tickets.
export async function addTicketEntry(input: AddTicketInput): Promise<AddTicketResult> {
  const channel = normalizeChannel(input.channel);
  const giveaway = await getActiveGiveaway(channel);
  if (!giveaway) return { ok: false, reason: 'no_giveaway' };
  if (giveaway.type !== 'ticket') return { ok: false, reason: 'wrong_type' };
  if (giveaway.status === 'paused') return { ok: false, reason: 'paused' };
  if (giveaway.status === 'locked' || giveaway.status === 'drawn') return { ok: false, reason: 'locked' };
  if (giveaway.status !== 'open') return { ok: false, reason: 'no_giveaway' };

  const existing = await GiveawayEntry.count({
    where: { giveaway_id: giveaway.id, user_id: input.userId },
  });
  if (existing >= 1) return { ok: false, reason: 'already_entered' };

  await GiveawayEntry.create({
    giveaway_id: giveaway.id,
    user_id: input.userId,
    username: input.username,
    created_at: new Date(),
  });
  return { ok: true };
}

export interface AddRedeemInput {
  rewardId: string;
  channel: string;
  userId: string;
  username: string;
  redemptionId: string;
}

/** Insert a redeem slot, idempotent on redemptionId (Twitch may retry deliveries). */
export async function addRedeemEntry(input: AddRedeemInput): Promise<{ ok: boolean; duplicate: boolean }> {
  const channel = normalizeChannel(input.channel);
  const giveaway = await getActiveGiveaway(channel);
  if (!giveaway || giveaway.status !== 'open' || giveaway.type !== 'redeem') {
    return { ok: false, duplicate: false };
  }
  if (giveaway.reward_id && giveaway.reward_id !== input.rewardId) {
    return { ok: false, duplicate: false };
  }

  const [, created] = await GiveawayEntry.findOrCreate({
    where: { giveaway_id: giveaway.id, redemption_id: input.redemptionId },
    defaults: {
      giveaway_id: giveaway.id,
      user_id: input.userId,
      username: input.username,
      redemption_id: input.redemptionId,
      created_at: new Date(),
    },
  });
  return { ok: true, duplicate: !created };
}

export interface ListEntriesResult {
  entries: GiveawayEntry[];
  perUser: { userId: string; username: string; count: number }[];
  total: number;
}

export async function listEntries(giveawayId: number): Promise<ListEntriesResult> {
  const entries = await GiveawayEntry.findAll({
    where: { giveaway_id: giveawayId },
    order: [['id', 'ASC']],
  });
  const byUser = new Map<string, { userId: string; username: string; count: number }>();
  for (const e of entries) {
    const existing = byUser.get(e.user_id);
    if (existing) existing.count += 1;
    else byUser.set(e.user_id, { userId: e.user_id, username: e.username, count: 1 });
  }
  return {
    entries,
    perUser: [...byUser.values()].sort((a, b) => b.count - a.count),
    total: entries.length,
  };
}

export type DrawResult =
  | { ok: true; username: string; userId: string; slot: number; total: number; winnerCount: number; target: number }
  | { ok: false; reason: 'no_entries' | 'all_won' | 'not_found' };

export function parseWinners(giveaway: Giveaway): GiveawayWinnerRecord[] {
  try {
    const parsed = JSON.parse(giveaway.winners_json || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Pick one entrant whose user_id is not in `excludeIds`, then persist the winners
 * list produced by `buildWinners`. Shared by draw (append) and redraw (replace last).
 */
async function pickWinner(
  giveaway: Giveaway,
  excludeIds: Set<string>,
  buildWinners: (rec: GiveawayWinnerRecord) => GiveawayWinnerRecord[],
  rng: Rng
): Promise<DrawResult> {
  const all = await GiveawayEntry.findAll({
    where: { giveaway_id: giveaway.id },
    order: [['id', 'ASC']],
  });
  if (all.length === 0) return { ok: false, reason: 'no_entries' };
  const eligible = all.filter((e) => !excludeIds.has(e.user_id));
  if (eligible.length === 0) return { ok: false, reason: 'all_won' };

  const winner = eligible[rng(eligible.length)];
  // winner_slot is the position within the full ordered entry list (1-based).
  const slot = all.findIndex((e) => e.id === winner.id) + 1;
  const record: GiveawayWinnerRecord = { userId: winner.user_id, username: winner.username, slot };
  const winners = buildWinners(record);

  await giveaway.update({
    status: 'drawn',
    winners_json: JSON.stringify(winners),
    winner_user_id: winner.user_id,
    winner_username: winner.username,
    winner_slot: slot,
    drawn_at: new Date(),
  });
  return {
    ok: true,
    username: winner.username,
    userId: winner.user_id,
    slot,
    total: all.length,
    winnerCount: winners.length,
    target: giveaway.target_winner_count,
  };
}

/** Draw the next winner, excluding everyone already drawn in this round. */
export async function drawWinner(giveawayId: number, rng: Rng = defaultRng): Promise<DrawResult> {
  const giveaway = await Giveaway.findByPk(giveawayId);
  if (!giveaway) return { ok: false, reason: 'not_found' };
  const winners = parseWinners(giveaway);
  const exclude = new Set(winners.map((w) => w.userId));
  return pickWinner(giveaway, exclude, (rec) => [...winners, rec], rng);
}

/** Replace the most recent winner (e.g. they declined), excluding all prior winners. */
export async function redraw(giveawayId: number, rng: Rng = defaultRng): Promise<DrawResult> {
  const giveaway = await Giveaway.findByPk(giveawayId);
  if (!giveaway) return { ok: false, reason: 'not_found' };
  const winners = parseWinners(giveaway);
  if (winners.length === 0) return drawWinner(giveawayId, rng);

  const remaining = winners.slice(0, -1);
  const declined = winners[winners.length - 1];
  const exclude = new Set([...remaining.map((w) => w.userId), declined.userId]);
  return pickWinner(giveaway, exclude, (rec) => [...remaining, rec], rng);
}

export async function closeGiveaway(giveawayId: number): Promise<void> {
  const giveaway = await Giveaway.findByPk(giveawayId);
  if (!giveaway) {
    logger.warn(`[giveaway] closeGiveaway: id ${giveawayId} not found`);
    return;
  }
  await giveaway.update({ status: 'closed', closed_at: new Date() });
}

/** Pause a running giveaway so new entries/redeems are refused. No-op if already drawn/closed. */
export async function pauseGiveaway(giveawayId: number): Promise<boolean> {
  const giveaway = await Giveaway.findByPk(giveawayId);
  if (!giveaway || giveaway.status !== 'open') return false;
  await giveaway.update({ status: 'paused' });
  return true;
}

/** Resume a paused giveaway so entries/redeems are accepted again. */
export async function resumeGiveaway(giveawayId: number): Promise<boolean> {
  const giveaway = await Giveaway.findByPk(giveawayId);
  if (!giveaway || giveaway.status !== 'paused') return false;
  await giveaway.update({ status: 'open' });
  return true;
}

/**
 * Close entries: freeze the entrant list so no new entries are accepted, while
 * keeping the giveaway drawable. Winners are then spun from whoever entered.
 */
export async function lockGiveaway(giveawayId: number): Promise<boolean> {
  const giveaway = await Giveaway.findByPk(giveawayId);
  if (!giveaway || (giveaway.status !== 'open' && giveaway.status !== 'paused')) return false;
  await giveaway.update({ status: 'locked' });
  return true;
}

/**
 * Wipe every entry and reopen the giveaway for another round, keeping the same
 * reward. Used after a channel-point winner accepts, so the raffle continues.
 */
export async function resetEntries(giveawayId: number): Promise<boolean> {
  const giveaway = await Giveaway.findByPk(giveawayId);
  if (!giveaway) return false;
  await GiveawayEntry.destroy({ where: { giveaway_id: giveawayId } });
  await giveaway.update({
    status: 'open',
    winners_json: '[]',
    winner_user_id: null,
    winner_username: null,
    winner_slot: null,
    drawn_at: null,
  });
  return true;
}
