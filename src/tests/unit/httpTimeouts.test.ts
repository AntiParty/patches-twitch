import assert from 'assert';
import {
  TWITCH_HTTP_TIMEOUT_MS,
  DISCORD_HTTP_TIMEOUT_MS,
  BOT_CONTROL_TIMEOUT_MS,
  EXTERNAL_HTTP_TIMEOUT_MS,
  fetchTimeoutSignal,
} from '../../util/httpTimeouts';

describe('httpTimeouts', () => {
  it('exposes the agreed timeouts', () => {
    assert.strictEqual(TWITCH_HTTP_TIMEOUT_MS, 10_000);
    assert.strictEqual(DISCORD_HTTP_TIMEOUT_MS, 5_000);
    assert.strictEqual(BOT_CONTROL_TIMEOUT_MS, 20_000);
    assert.strictEqual(EXTERNAL_HTTP_TIMEOUT_MS, 10_000);
  });

  it('keeps the bot-control timeout longer than the Twitch one (add-channel awaits a chat connect)', () => {
    assert.ok(BOT_CONTROL_TIMEOUT_MS > TWITCH_HTTP_TIMEOUT_MS);
  });

  it('fetchTimeoutSignal returns a signal that aborts with TimeoutError', async () => {
    const signal = fetchTimeoutSignal(20);
    assert.strictEqual(signal.aborted, false);
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.strictEqual(signal.aborted, true);
    assert.strictEqual((signal.reason as Error).name, 'TimeoutError');
  });
});
