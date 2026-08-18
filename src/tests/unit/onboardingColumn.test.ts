import { strict as assert } from 'assert';
import { Channel, dbReady } from '@/db';
import * as chatDropResolution from '@/util/chatDropResolution';

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

describe('Channel chat-readiness diagnostic', () => {
  before(async () => { await dbReady; });

  it('stores the latest actionable chat-send block for the dashboard', async () => {
    const username = `chatready_${Date.now()}`;
    // This diagnostic test does not exercise the default-command creation
    // hook; skipping it avoids competing SQLite writes in the unit suite.
    const row: any = await Channel.create({ username }, { hooks: false });
    const blockedAt = new Date();

    await row.update({
      chat_readiness_code: 'followers_only_mode',
      chat_readiness_message: 'This room is in followers-only mode.',
      chat_readiness_detected_at: blockedAt,
    });

    const reloaded: any = await Channel.findOne({ where: { username } });
    assert.equal(reloaded.chat_readiness_code, 'followers_only_mode');
    assert.equal(reloaded.chat_readiness_message, 'This room is in followers-only mode.');
    assert.ok(reloaded.chat_readiness_detected_at, 'expected a timestamp for the detected block');
    await row.destroy();
  });

  it('clears the diagnostic after Twitch accepts a later bot message', async () => {
    const username = `chatready_clear_${Date.now()}`;
    const row: any = await Channel.create({
      username,
      twitch_user_id: `chatready_clear_id_${Date.now()}`,
      chat_readiness_code: 'followers_only_mode',
      chat_readiness_message: 'This room is in followers-only mode.',
      chat_readiness_detected_at: new Date(),
    }, { hooks: false });

    const getChatReadinessUpdateForSend = (chatDropResolution as any).getChatReadinessUpdateForSend;
    assert.equal(typeof getChatReadinessUpdateForSend, 'function');
    await row.update(getChatReadinessUpdateForSend({ is_sent: true }));

    const reloaded: any = await Channel.findOne({ where: { username } });
    assert.equal(reloaded.chat_readiness_code, null);
    assert.equal(reloaded.chat_readiness_message, null);
    assert.equal(reloaded.chat_readiness_detected_at, null);
    await row.destroy();
  });
});
