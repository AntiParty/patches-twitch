import { strict as assert } from 'assert';
import { hasCustomBotAccess } from '@/chat/customBotAccess';

describe('custom bot access', () => {
  it('allows subscribed channels', () => {
    assert.equal(hasCustomBotAccess({ has_subscription: true, role: 'basic user' }), true);
  });
  it('allows privileged roles', () => {
    for (const role of ['tester', 'Staff', 'admin']) assert.equal(hasCustomBotAccess({ role }), true);
  });
  it('denies basic users without a subscription', () => {
    assert.equal(hasCustomBotAccess({ has_subscription: false, role: 'basic user' }), false);
    assert.equal(hasCustomBotAccess({}), false);
  });
});
