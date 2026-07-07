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
  pauseGiveaway,
  redraw,
  resetEntries,
  resumeGiveaway,
} from '@/services/giveaway.service';
import { hasRedemptionsScope } from '@/services/twitchChannelPoints.service';
import logger from '@/util/logger';

const BOT_CONTROL_URL = 'http://127.0.0.1:4000';

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
    const redeemScope = await hasRedemptionsScope(channel.id);
    return res.json({
      giveaway: serialize(giveaway),
      perUser: summary.perUser,
      total: summary.total,
      redeemScope,
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

async function setRewardPausedViaControl(channel: string, paused: boolean) {
  try {
    await axios.post(`${BOT_CONTROL_URL}/giveaway/redeem/pause`, { channel, paused }, { timeout: 8000 });
  } catch (err: any) {
    logger.error('[GiveawayDashboard] reward pause proxy failed', err?.response?.data || err?.message);
  }
}

router.post('/api/user/giveaways/pause', requireUserAPI, csrfProtection, (req, res) =>
  withChannel(req, res, 'pause', async (channel) => {
    const giveaway = await getActiveGiveaway(channel.username);
    if (!giveaway) return res.status(409).json({ error: 'No active giveaway.' });
    const ok = await pauseGiveaway(giveaway.id);
    if (giveaway.type === 'redeem' && giveaway.reward_id) {
      await setRewardPausedViaControl(channel.username, true);
    }
    return res.json({ success: ok });
  })
);

router.post('/api/user/giveaways/resume', requireUserAPI, csrfProtection, (req, res) =>
  withChannel(req, res, 'resume', async (channel) => {
    const giveaway = await getActiveGiveaway(channel.username);
    if (!giveaway) return res.status(409).json({ error: 'No active giveaway.' });
    const ok = await resumeGiveaway(giveaway.id);
    if (giveaway.type === 'redeem' && giveaway.reward_id) {
      await setRewardPausedViaControl(channel.username, false);
    }
    return res.json({ success: ok });
  })
);

// Channel-point "confirm winner accepted": wipe entries and reopen for another round.
router.post('/api/user/giveaways/reset', requireUserAPI, csrfProtection, (req, res) =>
  withChannel(req, res, 'reset', async (channel) => {
    const giveaway = await getActiveGiveaway(channel.username);
    if (!giveaway) return res.status(409).json({ error: 'No active giveaway.' });
    await resetEntries(giveaway.id);
    return res.json({ success: true });
  })
);

// --- Channel-point redeem giveaway: reward + EventSub lifecycle lives in the bot process ---

router.post('/api/user/giveaways/redeem/start', requireUserAPI, csrfProtection, (req, res) =>
  withChannel(req, res, 'redeemStart', async (channel) => {
    const prize = typeof req.body?.prize === 'string' ? req.body.prize.trim().slice(0, 45) : '';
    const cost = Math.max(1, Math.floor(Number(req.body?.cost) || 0));
    if (!cost) return res.status(400).json({ error: 'A point cost is required.' });
    try {
      const response = await axios.post(
        `${BOT_CONTROL_URL}/giveaway/redeem/start`,
        { channel: channel.username, prize, cost },
        { timeout: 10000 }
      );
      return res.json(response.data);
    } catch (err: any) {
      const status = err?.response?.status;
      const data = err?.response?.data;
      if (status === 403 && data?.reason === 'no_scope') {
        return res.status(403).json({ error: 'Reauthorization required.', state: 'reauth_required', reauthUrl: '/reauth' });
      }
      if (status === 409) return res.status(409).json({ error: data?.error || 'A giveaway is already active.' });
      logger.error('[GiveawayDashboard] redeemStart proxy failed', data || err?.message);
      return res.status(502).json({ error: 'Could not start the channel-point giveaway.' });
    }
  })
);

router.post('/api/user/giveaways/redeem/close', requireUserAPI, csrfProtection, (req, res) =>
  withChannel(req, res, 'redeemClose', async (channel) => {
    const giveaway = await getActiveGiveaway(channel.username);
    if (!giveaway) return res.status(409).json({ error: 'No active giveaway.' });
    try {
      await axios.post(
        `${BOT_CONTROL_URL}/giveaway/redeem/stop`,
        { channel: channel.username },
        { timeout: 10000 }
      );
    } catch (err: any) {
      logger.error('[GiveawayDashboard] redeemClose proxy failed', err?.response?.data || err?.message);
      // Still close the DB record so the streamer isn't stuck; reward may remain enabled.
    }
    await closeGiveaway(giveaway.id);
    return res.json({ success: true });
  })
);

export default router;
