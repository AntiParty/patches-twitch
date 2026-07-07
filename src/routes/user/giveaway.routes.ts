import { Router } from 'express';
import axios from 'axios';
import { Channel, Giveaway } from '@/db';
import { requireUserAPI } from '@/middleware/auth.middleware';
import { csrfProtection } from '@/middleware/csrf.middleware';
import {
  closeGiveaway,
  createGiveaway,
  drawWinner,
  getActiveGiveaway,
  listEntries,
  redraw,
} from '@/services/giveaway.service';
import logger from '@/util/logger';

interface ChannelIdentity {
  id: number;
  username: string;
}

async function resolveChannel(req: any): Promise<ChannelIdentity | null> {
  const sessionChannelId = Number(req.session?.channelId);
  if (Number.isInteger(sessionChannelId) && sessionChannelId > 0) {
    const channel = (await Channel.findByPk(sessionChannelId)) as any;
    if (channel) return { id: Number(channel.id), username: String(channel.username) };
  }
  const username = req.session?.twitchUsername;
  if (typeof username === 'string' && username) {
    const channel = (await Channel.findOne({ where: { username } })) as any;
    if (channel) return { id: Number(channel.id), username: String(channel.username) };
  }
  return null;
}

async function announce(channel: string, message: string): Promise<void> {
  try {
    await axios.post('http://127.0.0.1:4000/send-message', { channel, message }, { timeout: 5000 });
  } catch (err) {
    logger.error('[GiveawayDashboard] Chat announcement failed', err);
  }
}

function serialize(giveaway: Giveaway | null) {
  if (!giveaway) return null;
  return {
    id: giveaway.id,
    type: giveaway.type,
    status: giveaway.status,
    prize: giveaway.prize,
    maxTicketsPerUser: giveaway.max_tickets_per_user,
    rewardCost: giveaway.reward_cost,
    winnerUsername: giveaway.winner_username,
    winnerSlot: giveaway.winner_slot,
    createdAt: giveaway.created_at,
    drawnAt: giveaway.drawn_at,
  };
}

async function withChannel(
  req: any,
  res: any,
  operation: string,
  fn: (channel: ChannelIdentity) => Promise<any>
) {
  try {
    const channel = await resolveChannel(req);
    if (!channel) return res.status(404).json({ error: 'Channel not found.' });
    return await fn(channel);
  } catch (err) {
    logger.error(`[GiveawayDashboard] ${operation} failed`, err);
    return res.status(500).json({ error: 'Giveaway request failed.' });
  }
}

const router = Router();

router.get('/api/user/giveaways/current', requireUserAPI, (req, res) =>
  withChannel(req, res, 'current', async (channel) => {
    const giveaway = await getActiveGiveaway(channel.username);
    const summary = giveaway ? await listEntries(giveaway.id) : { perUser: [], total: 0 };
    return res.json({
      giveaway: serialize(giveaway),
      perUser: summary.perUser,
      total: summary.total,
      // Wired to a real scope check in Task 8.
      redeemScope: false,
    });
  })
);

router.post('/api/user/giveaways', requireUserAPI, csrfProtection, (req, res) =>
  withChannel(req, res, 'create', async (channel) => {
    const prize = typeof req.body?.prize === 'string' ? req.body.prize.trim().slice(0, 120) : null;
    const maxTicketsPerUser = Math.max(1, Math.min(1000, Number(req.body?.maxTicketsPerUser) || 1));
    const result = await createGiveaway({
      channel: channel.username,
      type: 'ticket',
      prize,
      maxTicketsPerUser,
    });
    if (!result.ok) {
      return res.status(409).json({ error: 'A giveaway is already active. Close it first.' });
    }
    return res.json({ giveaway: serialize(result.giveaway) });
  })
);

router.post('/api/user/giveaways/draw', requireUserAPI, csrfProtection, (req, res) =>
  withChannel(req, res, 'draw', async (channel) => {
    const giveaway = await getActiveGiveaway(channel.username);
    if (!giveaway) return res.status(409).json({ error: 'No active giveaway.' });
    const result = await drawWinner(giveaway.id);
    if (!result.ok) {
      return res.status(409).json({ error: 'No entries to draw from yet.' });
    }
    await announce(
      channel.username,
      `🎉 Giveaway winner: @${result.username} (slot #${result.slot} of ${result.total})! 🎁`
    );
    return res.json({ winner: { username: result.username, slot: result.slot, total: result.total } });
  })
);

router.post('/api/user/giveaways/redraw', requireUserAPI, csrfProtection, (req, res) =>
  withChannel(req, res, 'redraw', async (channel) => {
    const giveaway = await getActiveGiveaway(channel.username);
    if (!giveaway) return res.status(409).json({ error: 'No active giveaway.' });
    const excludePrevWinner = Boolean(req.body?.excludePrevWinner);
    const result = await redraw(giveaway.id, { excludePrevWinner });
    if (!result.ok) {
      return res.status(409).json({ error: 'No eligible entries to redraw.' });
    }
    await announce(
      channel.username,
      `🎉 New giveaway winner: @${result.username} (slot #${result.slot} of ${result.total})! 🎁`
    );
    return res.json({ winner: { username: result.username, slot: result.slot, total: result.total } });
  })
);

router.post('/api/user/giveaways/close', requireUserAPI, csrfProtection, (req, res) =>
  withChannel(req, res, 'close', async (channel) => {
    const giveaway = await getActiveGiveaway(channel.username);
    if (!giveaway) return res.status(409).json({ error: 'No active giveaway.' });
    await closeGiveaway(giveaway.id);
    return res.json({ success: true });
  })
);

export default router;
