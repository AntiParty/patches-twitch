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
  lockGiveaway,
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

  it('allows one entry per person and refuses a second', async () => {
    await createGiveaway({ channel, type: 'ticket', prize: 'A' });

    const r1 = await addTicketEntry({ channel, userId: 'u1', username: 'User1' });
    assert.equal(r1.ok, true);

    const r2 = await addTicketEntry({ channel, userId: 'u1', username: 'User1' });
    assert.equal(r2.ok, false);
    if (!r2.ok) assert.equal(r2.reason, 'already_entered');

    const active = await getActiveGiveaway(channel);
    const entries = await listEntries(active!.id);
    assert.equal(entries.total, 1);
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
    await createGiveaway({ channel, type: 'ticket', prize: 'A' });
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
      assert.equal(res.winnerCount, 1);
    }

    const reloaded = await getActiveGiveaway(channel);
    assert.equal(reloaded!.status, 'drawn');
    assert.equal(reloaded!.winner_username, 'User2');
    assert.equal(reloaded!.winner_slot, 2);
  });

  it('draws multiple winners, excluding everyone already drawn this round', async () => {
    await createGiveaway({ channel, type: 'redeem', prize: 'A', rewardCost: 100, targetWinnerCount: 3 });
    const created = await getActiveGiveaway(channel);
    await created!.update({ reward_id: 'rw' });
    for (const u of ['a', 'b', 'c']) {
      await addRedeemEntry({ rewardId: 'rw', channel, userId: u, username: u.toUpperCase(), redemptionId: `r-${u}` });
    }

    const w1 = await drawWinner(created!.id, () => 0); // A
    const w2 = await drawWinner(created!.id, () => 0); // excludes A -> B
    const w3 = await drawWinner(created!.id, () => 0); // excludes A,B -> C
    assert.ok(w1.ok && w2.ok && w3.ok);
    if (w1.ok && w2.ok && w3.ok) {
      assert.deepEqual([w1.username, w2.username, w3.username], ['A', 'B', 'C']);
      assert.equal(w3.winnerCount, 3);
      assert.equal(w3.target, 3);
    }

    // Everyone has now won → next draw reports all_won.
    const w4 = await drawWinner(created!.id, () => 0);
    assert.equal(w4.ok, false);
    if (!w4.ok) assert.equal(w4.reason, 'all_won');
  });

  it('lockGiveaway freezes entries but stays drawable', async () => {
    await createGiveaway({ channel, type: 'ticket', prize: 'A' });
    await addTicketEntry({ channel, userId: 'u1', username: 'User1' });
    const active = await getActiveGiveaway(channel);

    assert.equal(await lockGiveaway(active!.id), true);
    const blocked = await addTicketEntry({ channel, userId: 'u2', username: 'User2' });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.reason, 'locked');

    const res = await drawWinner(active!.id, () => 0);
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.username, 'User1');
  });

  it('returns no_entries when drawing an empty giveaway', async () => {
    await createGiveaway({ channel, type: 'ticket', prize: 'A' });
    const active = await getActiveGiveaway(channel);
    const res = await drawWinner(active!.id);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, 'no_entries');
  });

  it('redraw replaces the last winner and excludes them', async () => {
    await createGiveaway({ channel, type: 'ticket', prize: 'A' });
    await addTicketEntry({ channel, userId: 'u1', username: 'User1' });
    await addTicketEntry({ channel, userId: 'u2', username: 'User2' });

    const active = await getActiveGiveaway(channel);
    // First draw picks slot 0 -> User1
    await drawWinner(active!.id, () => 0);
    // Redraw: User1 declined; rng always 0 must still skip User1 -> User2
    const res = await redraw(active!.id, () => 0);
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.username, 'User2');
      assert.equal(res.winnerCount, 1); // replaced, not appended
    }
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
