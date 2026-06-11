import { strict as assert } from 'assert';
import { hasPredictionAutomationAccess } from '@/services/predictionAutomationAccess.service';

describe('prediction automation access', () => {
  it('allows active subscribers and approved early-access roles', () => {
    assert.equal(hasPredictionAutomationAccess({ has_subscription: true, role: 'Basic user' }), true);
    for (const role of ['subscriber', 'tester', 'Staff', 'admin']) {
      assert.equal(
        hasPredictionAutomationAccess({ has_subscription: false, role }),
        true,
        role,
      );
    }
  });

  it('rejects ordinary channels without a subscription', () => {
    assert.equal(
      hasPredictionAutomationAccess({ has_subscription: false, role: 'Basic user' }),
      false,
    );
  });
});
