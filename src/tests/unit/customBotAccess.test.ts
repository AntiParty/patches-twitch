import { strict as assert } from 'assert';
import { hasCustomBotAccess } from '@/chat/customBotAccess';

describe('custom bot access', () => {
  it('allows subscribed channels', () => {
    assert.equal(hasCustomBotAccess({ has_subscription: true, role: 'basic user' }), true);
  });
  it('allows privileged roles', () => {
    for (const role of ['subscriber', 'tester', 'Staff', 'admin']) assert.equal(hasCustomBotAccess({ role }), true, role);
  });
  it('compares roles case-insensitively', () => {
    for (const role of ['Subscriber', 'TESTER', 'staff', 'Admin']) assert.equal(hasCustomBotAccess({ role }), true, role);
  });
  it('denies basic users without a subscription', () => {
    assert.equal(hasCustomBotAccess({ has_subscription: false, role: 'basic user' }), false);
    assert.equal(hasCustomBotAccess({}), false);
  });
});
