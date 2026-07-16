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
  lockGiveaway,
  parseWinners,
  pauseGiveaway,
  redraw,
  resetEntries,
  resumeGiveaway,
} from '@/services/giveaway.service';
import { hasRedemptionsScope, updateReward } from '@/services/twitchChannelPoints.service';
import logger from '@/util/logger';
import { botControlHeaders, botControlUrl } from '@/util/botControl';

const BOT_CONTROL_URL = botControlUrl;

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
    await axios.post(`${BOT_CONTROL_URL}/send-message`, { channel, message }, { timeout: 5000, headers: botControlHeaders() });
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
    targetWinnerCount: giveaway.target_winner_count,
    winners: parseWinners(giveaway),
    rewardCost: giveaway.reward_cost,
    maxPerUserPerStream: giveaway.max_per_user_per_stream,
    maxPerStream: giveaway.max_per_stream,
    cooldownSeconds: giveaway.cooldown_seconds,
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
    const result = await createGiveaway({
      channel: channel.username,
      type: 'ticket',
      prize,
      // One entry per person; 0 = spin as many winners as you want.
      targetWinnerCount: 0,
    });
    if (!result.ok) {
      return res.status(409).json({ error: 'A giveaway is already active. Close it first.' });
    }
    return res.json({ giveaway: serialize(result.giveaway) });
  })
);

// Edit the live giveaway. Prize applies to both types; cost/prompt/color also
// patch the Twitch reward (the redemption subscription is keyed by reward id,
// so entries keep flowing while the reward changes).
router.post('/api/user/giveaways/update', requireUserAPI, csrfProtection, (req, res) =>
  withChannel(req, res, 'update', async (channel) => {
    const giveaway = await getActiveGiveaway(channel.username);
    if (!giveaway) return res.status(409).json({ error: 'No active giveaway.' });

    const maxPrizeLen = giveaway.type === 'redeem' ? 45 : 120;
    const prize =
      typeof req.body?.prize === 'string' && req.body.prize.trim()
        ? req.body.prize.trim().slice(0, maxPrizeLen)
        : null;
    const cost = Number.isFinite(Number(req.body?.cost)) && Number(req.body?.cost) > 0
      ? Math.floor(Number(req.body.cost))
      : null;
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim().slice(0, 200) : '';
    const backgroundColor =
      typeof req.body?.backgroundColor === 'string' ? req.body.backgroundColor : '';
    // New winner target; can't drop below the number already drawn this round.
    const rawWinnerCount = Number(req.body?.winnerCount);
    const winnerCount =
      Number.isFinite(rawWinnerCount) && rawWinnerCount >= 1
        ? Math.max(parseWinners(giveaway).length, Math.min(50, Math.floor(rawWinnerCount)))
        : null;
    // Reward limits: undefined = not sent (keep current); <1 or non-numeric = explicitly turn off.
    const parseLimitPatch = (v: unknown): number | null | undefined => {
      if (v === undefined) return undefined;
      const n = Math.floor(Number(v));
      return Number.isFinite(n) && n >= 1 ? n : null;
    };
    const maxPerUserPerStream = parseLimitPatch(req.body?.maxPerUserPerStream);
    const maxPerStream = parseLimitPatch(req.body?.maxPerStream);
    const cooldownSeconds = parseLimitPatch(req.body?.cooldownSeconds);

    if (giveaway.type === 'redeem' && giveaway.reward_id) {
      const patched = await updateReward(channel.id, giveaway.reward_id, {
        title: prize ?? undefined,
        cost: cost ?? undefined,
        prompt: prompt || undefined,
        backgroundColor: backgroundColor || undefined,
        maxPerUserPerStream,
        maxPerStream,
        cooldownSeconds,
      });
      if (!patched) {
        return res.status(502).json({ error: 'Twitch rejected the reward update.' });
      }
    }

    const isRedeem = giveaway.type === 'redeem';
    await giveaway.update({
      ...(prize ? { prize } : {}),
      ...(isRedeem && cost ? { reward_cost: cost } : {}),
      ...(isRedeem && winnerCount ? { target_winner_count: winnerCount } : {}),
      ...(isRedeem && maxPerUserPerStream !== undefined ? { max_per_user_per_stream: maxPerUserPerStream } : {}),
      ...(isRedeem && maxPerStream !== undefined ? { max_per_stream: maxPerStream } : {}),
      ...(isRedeem && cooldownSeconds !== undefined ? { cooldown_seconds: cooldownSeconds } : {}),
    });
    return res.json({ giveaway: serialize(giveaway) });
  })
);

// "Close Giveaway": stop new entries, keep it drawable from whoever entered.
router.post('/api/user/giveaways/lock', requireUserAPI, csrfProtection, (req, res) =>
  withChannel(req, res, 'lock', async (channel) => {
    const giveaway = await getActiveGiveaway(channel.username);
    if (!giveaway) return res.status(409).json({ error: 'No active giveaway.' });
    const ok = await lockGiveaway(giveaway.id);
    if (giveaway.type === 'redeem' && giveaway.reward_id) {
      await setRewardPausedViaControl(channel.username, true);
    }
    return res.json({ success: ok });
  })
);

// Draw/redraw only pick the winner and return it. The chat announcement is a
// separate call the dashboard fires once the on-stream roll animation finishes,
// so chat doesn't see the winner before the reveal.
router.post('/api/user/giveaways/draw', requireUserAPI, csrfProtection, (req, res) =>
  withChannel(req, res, 'draw', async (channel) => {
    const giveaway = await getActiveGiveaway(channel.username);
    if (!giveaway) return res.status(409).json({ error: 'No active giveaway.' });
    const result = await drawWinner(giveaway.id);
    if (!result.ok) {
      return res.status(409).json({ error: 'No entries to draw from yet.' });
    }
    return res.json({ winner: { username: result.username, slot: result.slot, total: result.total } });
  })
);

router.post('/api/user/giveaways/redraw', requireUserAPI, csrfProtection, (req, res) =>
  withChannel(req, res, 'redraw', async (channel) => {
    const giveaway = await getActiveGiveaway(channel.username);
    if (!giveaway) return res.status(409).json({ error: 'No active giveaway.' });
    const result = await redraw(giveaway.id);
    if (!result.ok) {
      return res.status(409).json({ error: 'No eligible entries to redraw.' });
    }
    return res.json({ winner: { username: result.username, slot: result.slot, total: result.total } });
  })
);

// Announce the giveaway's current winner in chat. Reads the persisted winner so
// the client can't inject arbitrary chat content.
router.post('/api/user/giveaways/announce', requireUserAPI, csrfProtection, (req, res) =>
  withChannel(req, res, 'announce', async (channel) => {
    const giveaway = await getActiveGiveaway(channel.username);
    if (!giveaway || !giveaway.winner_username) {
      return res.status(409).json({ error: 'No winner to announce.' });
    }
    const winners = parseWinners(giveaway);
    const target = giveaway.target_winner_count;
    // "Winner #2 of 3" when the streamer is drawing multiple; plain otherwise.
    const label =
      target > 1 ? `Giveaway winner #${winners.length} of ${target}` : 'Giveaway winner';
    await announce(channel.username, `${label}: @${giveaway.winner_username}!`);
    return res.json({ success: true });
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
    await axios.post(`${BOT_CONTROL_URL}/giveaway/redeem/pause`, { channel, paused }, { timeout: 8000, headers: botControlHeaders() });
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
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim().slice(0, 200) : '';
    const backgroundColor = typeof req.body?.backgroundColor === 'string' ? req.body.backgroundColor : '';
    const winnerCount = Math.max(1, Math.min(50, Math.floor(Number(req.body?.winnerCount) || 1)));
    const maxPerUserPerStream = req.body?.maxPerUserPerStream;
    const maxPerStream = req.body?.maxPerStream;
    const cooldownSeconds = req.body?.cooldownSeconds;
    if (!cost) return res.status(400).json({ error: 'A point cost is required.' });
    try {
      const response = await axios.post(
        `${BOT_CONTROL_URL}/giveaway/redeem/start`,
        {
          channel: channel.username,
          prize,
          cost,
          prompt,
          backgroundColor,
          winnerCount,
          maxPerUserPerStream,
          maxPerStream,
          cooldownSeconds,
        },
        { timeout: 10000, headers: botControlHeaders() }
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
        { timeout: 10000, headers: botControlHeaders() }
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
