import { strict as assert } from 'assert';
import { resolvePremiumStatus } from '@/services/premiumStatus.service';

const now = new Date('2026-06-01T00:00:00Z');
const future = new Date('2026-07-01T00:00:00Z');
const past = new Date('2026-05-01T00:00:00Z');

describe('resolvePremiumStatus', () => {
  it('Twitch sub wins and uses the Twitch tier', () => {
    const r = resolvePremiumStatus(
      { isPremium: true, tier: '2000' },
      { status: 'active', plan_type: 'custom_bot', current_period_end: future },
      now,
    );
    assert.deepEqual(r, { hasSubscription: true, tier: '2000' });
  });
  it('active grant with future end grants premium with plan_type tier', () => {
    const r = resolvePremiumStatus({ isPremium: false, tier: null }, { status: 'active', plan_type: 'custom_bot', current_period_end: future }, now);
    assert.deepEqual(r, { hasSubscription: true, tier: 'custom_bot' });
  });
  it('active grant with null end never expires', () => {
    const r = resolvePremiumStatus({ isPremium: false, tier: null }, { status: 'active', plan_type: 'x', current_period_end: null }, now);
    assert.equal(r.hasSubscription, true);
  });
  it('expired grant does not grant premium', () => {
    const r = resolvePremiumStatus({ isPremium: false, tier: null }, { status: 'active', plan_type: 'x', current_period_end: past }, now);
    assert.deepEqual(r, { hasSubscription: false, tier: null });
  });
  it('inactive grant does not grant premium', () => {
    const r = resolvePremiumStatus({ isPremium: false, tier: null }, { status: 'inactive', plan_type: 'x', current_period_end: future }, now);
    assert.deepEqual(r, { hasSubscription: false, tier: null });
  });
  it('no grant and no Twitch sub is not premium', () => {
    assert.deepEqual(resolvePremiumStatus({ isPremium: false, tier: null }, null, now), { hasSubscription: false, tier: null });
  });
});
