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
  rewardCost?: number | null;
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
    reward_cost: input.rewardCost ?? null,
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
  | { ok: true; ticketCount: number; cap: number }
  | { ok: false; reason: 'no_giveaway' | 'wrong_type' | 'at_cap' | 'paused'; ticketCount?: number; cap?: number };

export async function addTicketEntry(input: AddTicketInput): Promise<AddTicketResult> {
  const channel = normalizeChannel(input.channel);
  const giveaway = await getActiveGiveaway(channel);
  if (!giveaway) return { ok: false, reason: 'no_giveaway' };
  if (giveaway.type !== 'ticket') return { ok: false, reason: 'wrong_type' };
  if (giveaway.status === 'paused') return { ok: false, reason: 'paused' };
  if (giveaway.status !== 'open') return { ok: false, reason: 'no_giveaway' };

  const cap = giveaway.max_tickets_per_user;
  const current = await GiveawayEntry.count({
    where: { giveaway_id: giveaway.id, user_id: input.userId },
  });
  if (current >= cap) return { ok: false, reason: 'at_cap', ticketCount: current, cap };

  await GiveawayEntry.create({
    giveaway_id: giveaway.id,
    user_id: input.userId,
    username: input.username,
    created_at: new Date(),
  });
  return { ok: true, ticketCount: current + 1, cap };
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
  | { ok: true; username: string; userId: string; slot: number; total: number }
  | { ok: false; reason: 'no_entries' | 'not_found' };

async function drawFrom(
  giveawayId: number,
  entries: GiveawayEntry[],
  rng: Rng
): Promise<DrawResult> {
  const giveaway = await Giveaway.findByPk(giveawayId);
  if (!giveaway) return { ok: false, reason: 'not_found' };
  if (entries.length === 0) return { ok: false, reason: 'no_entries' };

  const idx = rng(entries.length);
  const winner = entries[idx];
  // winner_slot is the position within the full ordered entry list (1-based).
  const all = await GiveawayEntry.findAll({
    where: { giveaway_id: giveawayId },
    order: [['id', 'ASC']],
  });
  const slot = all.findIndex((e) => e.id === winner.id) + 1;

  await giveaway.update({
    status: 'drawn',
    winner_user_id: winner.user_id,
    winner_username: winner.username,
    winner_slot: slot,
    drawn_at: new Date(),
  });
  return { ok: true, username: winner.username, userId: winner.user_id, slot, total: all.length };
}

export async function drawWinner(giveawayId: number, rng: Rng = defaultRng): Promise<DrawResult> {
  const entries = await GiveawayEntry.findAll({
    where: { giveaway_id: giveawayId },
    order: [['id', 'ASC']],
  });
  return drawFrom(giveawayId, entries, rng);
}

export async function redraw(
  giveawayId: number,
  opts: { excludePrevWinner?: boolean } = {},
  rng: Rng = defaultRng
): Promise<DrawResult> {
  const giveaway = await Giveaway.findByPk(giveawayId);
  if (!giveaway) return { ok: false, reason: 'not_found' };

  let entries = await GiveawayEntry.findAll({
    where: { giveaway_id: giveawayId },
    order: [['id', 'ASC']],
  });
  if (opts.excludePrevWinner && giveaway.winner_user_id) {
    entries = entries.filter((e) => e.user_id !== giveaway.winner_user_id);
  }
  return drawFrom(giveawayId, entries, rng);
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
 * Wipe every entry and reopen the giveaway for another round, keeping the same
 * reward. Used after a channel-point winner accepts, so the raffle continues.
 */
export async function resetEntries(giveawayId: number): Promise<boolean> {
  const giveaway = await Giveaway.findByPk(giveawayId);
  if (!giveaway) return false;
  await GiveawayEntry.destroy({ where: { giveaway_id: giveawayId } });
  await giveaway.update({
    status: 'open',
    winner_user_id: null,
    winner_username: null,
    winner_slot: null,
    drawn_at: null,
  });
  return true;
}
