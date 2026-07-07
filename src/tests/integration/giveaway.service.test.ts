import { strict as assert } from 'assert';
import { Op } from 'sequelize';
import { Giveaway, GiveawayEntry, dbReady } from '@/db';
import {
  addRedeemEntry,
  addTicketEntry,
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

describe('giveaway.service', function () {
  this.timeout(15000);

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const channel = `giveaway-test-${suffix}`;

  async function cleanup() {
    const rows = await Giveaway.findAll({ where: { channel: { [Op.like]: 'giveaway-test-%' } } });
    const ids = rows.map((r) => r.id);
    if (ids.length) {
      await GiveawayEntry.destroy({ where: { giveaway_id: ids } });
      await Giveaway.destroy({ where: { id: ids } });
    }
  }

  before(async () => {
    await dbReady;
    await cleanup();
  });

  afterEach(cleanup);

  it('rejects creating a second active giveaway for the same channel', async () => {
    const first = await createGiveaway({ channel, type: 'ticket', prize: 'A', maxTicketsPerUser: 3 });
    assert.equal(first.ok, true);

    const second = await createGiveaway({ channel, type: 'ticket', prize: 'B' });
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.reason, 'already_active');
  });

  it('adds ticket entries up to the cap then refuses', async () => {
    await createGiveaway({ channel, type: 'ticket', prize: 'A', maxTicketsPerUser: 2 });

    const r1 = await addTicketEntry({ channel, userId: 'u1', username: 'User1' });
    assert.equal(r1.ok, true);
    if (r1.ok) assert.equal(r1.ticketCount, 1);

    const r2 = await addTicketEntry({ channel, userId: 'u1', username: 'User1' });
    assert.equal(r2.ok, true);
    if (r2.ok) assert.equal(r2.ticketCount, 2);

    const r3 = await addTicketEntry({ channel, userId: 'u1', username: 'User1' });
    assert.equal(r3.ok, false);
    if (!r3.ok) {
      assert.equal(r3.reason, 'at_cap');
      assert.equal(r3.cap, 2);
    }
  });

  it('reports no_giveaway when none is open', async () => {
    const r = await addTicketEntry({ channel, userId: 'u1', username: 'User1' });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'no_giveaway');
  });

  it('is idempotent on redemption_id for redeem entries', async () => {
    const created = await createGiveaway({ channel, type: 'redeem', prize: 'A', rewardCost: 100 });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    await created.giveaway.update({ reward_id: 'reward-xyz' });

    const first = await addRedeemEntry({
      rewardId: 'reward-xyz',
      channel,
      userId: 'u1',
      username: 'User1',
      redemptionId: 'redeem-1',
    });
    assert.equal(first.ok, true);
    assert.equal(first.duplicate, false);

    const dup = await addRedeemEntry({
      rewardId: 'reward-xyz',
      channel,
      userId: 'u1',
      username: 'User1',
      redemptionId: 'redeem-1',
    });
    assert.equal(dup.duplicate, true);

    const active = await getActiveGiveaway(channel);
    const entries = await listEntries(active!.id);
    assert.equal(entries.total, 1);
  });

  it('draws the entrant at the rng-selected slot (1-based)', async () => {
    await createGiveaway({ channel, type: 'ticket', prize: 'A', maxTicketsPerUser: 5 });
    await addTicketEntry({ channel, userId: 'u1', username: 'User1' });
    await addTicketEntry({ channel, userId: 'u2', username: 'User2' });
    await addTicketEntry({ channel, userId: 'u3', username: 'User3' });

    const active = await getActiveGiveaway(channel);
    const res = await drawWinner(active!.id, () => 1);
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.username, 'User2');
      assert.equal(res.slot, 2);
      assert.equal(res.total, 3);
    }

    const reloaded = await getActiveGiveaway(channel);
    assert.equal(reloaded!.status, 'drawn');
    assert.equal(reloaded!.winner_username, 'User2');
    assert.equal(reloaded!.winner_slot, 2);
  });

  it('returns no_entries when drawing an empty giveaway', async () => {
    await createGiveaway({ channel, type: 'ticket', prize: 'A' });
    const active = await getActiveGiveaway(channel);
    const res = await drawWinner(active!.id);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, 'no_entries');
  });

  it('redraw excluding the previous winner never returns that winner', async () => {
    await createGiveaway({ channel, type: 'ticket', prize: 'A', maxTicketsPerUser: 5 });
    await addTicketEntry({ channel, userId: 'u1', username: 'User1' });
    await addTicketEntry({ channel, userId: 'u2', username: 'User2' });

    const active = await getActiveGiveaway(channel);
    // First draw picks slot 0 -> User1
    await drawWinner(active!.id, () => 0);
    // Redraw excluding prev winner; rng always 0 must still skip User1's rows
    const res = await redraw(active!.id, { excludePrevWinner: true }, () => 0);
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.username, 'User2');
  });

  it('closeGiveaway marks it closed so it is no longer active', async () => {
    await createGiveaway({ channel, type: 'ticket', prize: 'A' });
    const active = await getActiveGiveaway(channel);
    await closeGiveaway(active!.id);
    const after = await getActiveGiveaway(channel);
    assert.equal(after, null);
  });

  it('pause blocks ticket entries and resume allows them again', async () => {
    await createGiveaway({ channel, type: 'ticket', prize: 'A', maxTicketsPerUser: 5 });
    const active = await getActiveGiveaway(channel);

    assert.equal(await pauseGiveaway(active!.id), true);
    const paused = await addTicketEntry({ channel, userId: 'u1', username: 'User1' });
    assert.equal(paused.ok, false);
    if (!paused.ok) assert.equal(paused.reason, 'paused');

    assert.equal(await resumeGiveaway(active!.id), true);
    const resumed = await addTicketEntry({ channel, userId: 'u1', username: 'User1' });
    assert.equal(resumed.ok, true);
  });

  it('resetEntries wipes entries and reopens the giveaway for another round', async () => {
    const created = await createGiveaway({ channel, type: 'redeem', prize: 'A', rewardCost: 100 });
    if (!created.ok) throw new Error('expected create ok');
    await created.giveaway.update({ reward_id: 'reward-xyz' });
    await addRedeemEntry({ rewardId: 'reward-xyz', channel, userId: 'u1', username: 'User1', redemptionId: 'r-1' });

    const active = await getActiveGiveaway(channel);
    await drawWinner(active!.id, () => 0);

    assert.equal(await resetEntries(active!.id), true);
    const after = await getActiveGiveaway(channel);
    assert.equal(after!.status, 'open');
    assert.equal(after!.winner_username, null);
    const entries = await listEntries(after!.id);
    assert.equal(entries.total, 0);
  });
});
