import { strict as assert } from 'assert';
import { Channel, dbReady } from '@/db';

describe('Channel.onboarding_completed_at', () => {
  before(async () => { await dbReady; });

  it('defaults to null and is writable', async () => {
    const username = `onbtest_${Date.now()}`;
    const row: any = await Channel.create({ username });
    assert.equal(row.onboarding_completed_at ?? null, null);
    const now = new Date();
    await row.update({ onboarding_completed_at: now });
    const reloaded: any = await Channel.findOne({ where: { username } });
    assert.ok(reloaded.onboarding_completed_at, 'expected a timestamp after update');
    await row.destroy();
  });
});
