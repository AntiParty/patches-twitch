import { strict as assert } from 'assert';
import {
  checkTwitchSubscription,
  checkAndUpdatePremiumStatus,
} from '@/services/twitchSubscription.service';

function httpError(status: number) {
  const err: any = new Error(`HTTP ${status}`);
  err.isAxiosError = true;
  err.response = { status };
  return err;
}
function networkError() {
  const err: any = new Error('ECONNRESET');
  err.isAxiosError = true;
  return err;
}
const subscribed = async () => ({ data: { data: [{ tier: '2000', gifter_login: 'bob' }] } });
const emptyOk = async () => ({ data: { data: [] } });

describe('checkTwitchSubscription', () => {
  it('200 with data is subscribed', async () => {
    const s = await checkTwitchSubscription('tok', '1', { get: subscribed as any });
    assert.equal(s.isPremium, true);
    assert.equal(s.tier, '2000');
    assert.equal(s.giftedBy, 'bob');
    assert.ok(!s.unknown);
  });
  it('200 with empty data is a verdict of not subscribed', async () => {
    const s = await checkTwitchSubscription('tok', '1', { get: emptyOk as any });
    assert.equal(s.isPremium, false);
    assert.ok(!s.unknown);
  });
  it('404 is a verdict of not subscribed', async () => {
    const s = await checkTwitchSubscription('tok', '1', { get: (async () => { throw httpError(404); }) as any });
    assert.equal(s.isPremium, false);
    assert.ok(!s.unknown);
  });
  for (const code of [401, 403, 429, 500, 503]) {
    it(`${code} is unknown, not a verdict`, async () => {
      const s = await checkTwitchSubscription('tok', '1', { get: (async () => { throw httpError(code); }) as any });
      assert.equal(s.unknown, true);
      assert.equal(s.httpStatus, code);
    });
  }
  it('network error is unknown', async () => {
    const s = await checkTwitchSubscription('tok', '1', { get: (async () => { throw networkError(); }) as any });
    assert.equal(s.unknown, true);
  });
});

function makeDeps(over: any = {}) {
  const writes: any[] = [];
  const checkCalls: string[] = [];
  const deps = {
    findChannel: async () => ({ id: 7, username: 'u', twitch_user_id: '99', access_token: 'enc:blob' }),
    decrypt: () => 'plain',
    refresh: async () => 'fresh',
    check: async (token: string) => {
      checkCalls.push(token);
      return { isPremium: false, tier: null, giftedBy: null, checkedAt: new Date() };
    },
    loadGrant: async () => null,
    updateChannel: async (_id: number, values: any) => { writes.push(values); },
    ...over,
  };
  return { deps, writes, checkCalls };
}
const unauthorized = { isPremium: false, tier: null, giftedBy: null, checkedAt: new Date(), unknown: true, httpStatus: 401 };
const subbed = { isPremium: true, tier: '1000', giftedBy: null, checkedAt: new Date() };

describe('checkAndUpdatePremiumStatus', () => {
  it('uses the decrypted token, not the stored ciphertext', async () => {
    const seen: string[] = [];
    const { deps, writes } = makeDeps({ check: async (t: string) => { seen.push(t); return subbed; } });
    const s = await checkAndUpdatePremiumStatus(7, deps as any);
    assert.deepEqual(seen, ['plain']);
    assert.equal(s.isPremium, true);
    assert.deepEqual(writes, [{ has_subscription: true, subscription_tier: '1000' }]);
  });

  it('null decrypt returns unknown and does not write', async () => {
    const { deps, writes, checkCalls } = makeDeps({ decrypt: () => null });
    const s = await checkAndUpdatePremiumStatus(7, deps as any);
    assert.equal(s.unknown, true);
    assert.equal(writes.length, 0);
    assert.equal(checkCalls.length, 0);
  });

  it('401 then refresh success retries with the new token', async () => {
    let n = 0;
    const tokens: string[] = [];
    const { deps, writes } = makeDeps({
      check: async (t: string) => { tokens.push(t); return n++ === 0 ? unauthorized : subbed; },
    });
    const s = await checkAndUpdatePremiumStatus(7, deps as any);
    assert.deepEqual(tokens, ['plain', 'fresh']);
    assert.equal(s.isPremium, true);
    assert.equal(writes.length, 1);
  });

  it('401 then refresh failure returns unknown and does not write', async () => {
    const { deps, writes } = makeDeps({ check: async () => unauthorized, refresh: async () => null });
    const s = await checkAndUpdatePremiumStatus(7, deps as any);
    assert.equal(s.unknown, true);
    assert.equal(writes.length, 0);
  });

  it('401 on retry returns unknown and does not write', async () => {
    let refreshes = 0;
    const { deps, writes } = makeDeps({
      check: async () => unauthorized,
      refresh: async () => { refreshes++; return 'fresh'; },
    });
    const s = await checkAndUpdatePremiumStatus(7, deps as any);
    assert.equal(s.unknown, true);
    assert.equal(refreshes, 1);
    assert.equal(writes.length, 0);
  });

  it('preserves an active manual grant when Twitch says not subscribed', async () => {
    const { deps, writes } = makeDeps({
      loadGrant: async () => ({ status: 'active', plan_type: 'custom_bot', current_period_end: new Date(Date.now() + 86_400_000) }),
    });
    const s = await checkAndUpdatePremiumStatus(7, deps as any);
    assert.equal(s.isPremium, true);
    assert.equal(s.tier, 'custom_bot');
    assert.deepEqual(writes, [{ has_subscription: true, subscription_tier: 'custom_bot' }]);
  });

  it('does not write on a generic unknown (e.g. 500)', async () => {
    const { deps, writes } = makeDeps({
      check: async () => ({ ...unauthorized, httpStatus: 500 }),
    });
    const s = await checkAndUpdatePremiumStatus(7, deps as any);
    assert.equal(s.unknown, true);
    assert.equal(writes.length, 0);
  });
});
