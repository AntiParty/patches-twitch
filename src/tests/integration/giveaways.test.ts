import { strict as assert } from 'assert';
import { Op } from 'sequelize';
import { Channel, Giveaway, GiveawayEntry, dbReady } from '@/db';
import {
  addRedeemEntry,
  addTicketEntry,
  createGiveaway,
  drawWinner,
  getActiveGiveaway,
} from '@/services/giveaway.service';
import { createReward } from '@/services/twitchChannelPoints.service';

describe('giveaways integration', function () {
  this.timeout(15000);

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const channel = `giveaway-int-${suffix}`;
  const createdChannelIds: number[] = [];

  async function cleanup() {
    const rows = await Giveaway.findAll({ where: { channel: { [Op.like]: 'giveaway-int-%' } } });
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

  after(async () => {
    await cleanup();
    if (createdChannelIds.length) {
      await Channel.destroy({ where: { id: createdChannelIds } });
    }
  });

  afterEach(cleanup);

  it('runs the full ticket flow: create -> enter -> draw', async () => {
    await createGiveaway({ channel, type: 'ticket', prize: 'Prize', maxTicketsPerUser: 3 });
    await addTicketEntry({ channel, userId: 'a', username: 'Alice' });
    await addTicketEntry({ channel, userId: 'b', username: 'Bob' });

    const active = await getActiveGiveaway(channel);
    const drawn = await drawWinner(active!.id, () => 0);
    assert.equal(drawn.ok, true);
    if (drawn.ok) {
      assert.equal(drawn.username, 'Alice');
      assert.equal(drawn.slot, 1);
      assert.equal(drawn.total, 2);
    }
  });

  it('rejects a redeem entry when no redeem giveaway is open', async () => {
    const r = await addRedeemEntry({
      rewardId: 'reward-1',
      channel,
      userId: 'u1',
      username: 'User1',
      redemptionId: 'r-1',
    });
    assert.equal(r.ok, false);
    assert.equal(r.duplicate, false);
  });

  it('rejects a redeem entry against a ticket giveaway', async () => {
    await createGiveaway({ channel, type: 'ticket', prize: 'Prize', maxTicketsPerUser: 1 });
    const r = await addRedeemEntry({
      rewardId: 'reward-1',
      channel,
      userId: 'u1',
      username: 'User1',
      redemptionId: 'r-1',
    });
    assert.equal(r.ok, false);
  });

  it('ignores a redeem entry whose reward id does not match the giveaway', async () => {
    const created = await createGiveaway({ channel, type: 'redeem', prize: 'Prize', rewardCost: 100 });
    if (!created.ok) throw new Error('expected create ok');
    await created.giveaway.update({ reward_id: 'reward-correct' });

    const r = await addRedeemEntry({
      rewardId: 'reward-wrong',
      channel,
      userId: 'u1',
      username: 'User1',
      redemptionId: 'r-1',
    });
    assert.equal(r.ok, false);
    const entries = await GiveawayEntry.count({ where: { giveaway_id: created.giveaway.id } });
    assert.equal(entries, 0);
  });

  it('createReward returns no_scope when the broadcaster has no usable token', async () => {
    const ch = await Channel.create({
      username: `giveaway-int-noscope-${suffix}`,
      twitch_user_id: `tid-${suffix}`,
    });
    createdChannelIds.push(ch.id);

    const result = await createReward(ch.id, { title: 'Giveaway Entry', cost: 500 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'no_scope');
  });
});
