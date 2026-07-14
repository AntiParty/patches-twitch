import { strict as assert } from 'assert';
import { buildIgnNotFoundNotice } from '@/jobs/streamSessionPoller';
import { Channel, dbReady } from '@/db';

describe('buildIgnNotFoundNotice', () => {
  it('names the ign and points to the dashboard', () => {
    const msg = buildIgnNotFoundNotice('Lamp#5944');
    assert.ok(msg.includes('Lamp#5944'), 'mentions the ign');
    assert.ok(msg.includes('finalsrs.com/dashboard'), 'points to the dashboard');
  });
});

describe('Channel.ign_not_found_notified_at (one-time notice flag)', () => {
  before(async () => { await dbReady; });

  it('defaults to null, is writable, and clears on re-link', async () => {
    const username = `igntest_${Date.now()}`;
    const row: any = await Channel.create({ username, player_id: 'Lamp#5944' });
    assert.equal(row.ign_not_found_notified_at ?? null, null);

    // Poller marks the notice sent.
    await row.update({ ign_not_found_notified_at: new Date() });
    let reloaded: any = await Channel.findOne({ where: { username } });
    assert.ok(reloaded.ign_not_found_notified_at, 'expected a timestamp after notice');

    // Re-linking a (corrected) IGN resets the flag, same shape as the
    // link-account route and !link command updates.
    await reloaded.update({ player_id: 'Lamp#1111', ign_not_found_notified_at: null });
    reloaded = await Channel.findOne({ where: { username } });
    assert.equal(reloaded.ign_not_found_notified_at ?? null, null);

    await row.destroy();
  });
});
