/**
 * Unit Tests for Subscription Middleware
 * Tests the subscription gating logic for paid features
 */

import { describe, it, beforeEach, afterEach } from 'mocha';
import { strict as assert } from 'assert';
import {
  createMockRequest,
  createMockResponse,
  createMockNext,
  TestScenarios,
  runMiddleware,
} from '../setup';

// Import the middleware functions
import {
  requireSubscription,
  requireSubscriptionAPI,
  hasSubscription,
} from '../../middleware/subscription.middleware';

describe('Subscription Middleware', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    // Ensure we're not in development mode for most tests
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('requireSubscription()', () => {
    it('should redirect to /auth/twitch if user is not logged in', async () => {
      const { res, next } = await runMiddleware(requireSubscription, TestScenarios.anonymous);

      assert.equal(res.redirectUrl, '/auth/twitch', 'Should redirect to auth');
      assert.equal(next.called, false, 'Should not call next');
    });

    it('should allow access for users with active subscription', async () => {
      const { res, next } = await runMiddleware(requireSubscription, TestScenarios.subscriber);

      assert.equal(res.redirectUrl, null, 'Should not redirect');
      assert.equal(next.called, true, 'Should call next');
    });

    it('should redirect free users to /subscribe', async () => {
      const { res, next } = await runMiddleware(requireSubscription, TestScenarios.freeUser);

      assert.equal(res.redirectUrl, '/subscribe', 'Should redirect to subscribe page');
      assert.equal(next.called, false, 'Should not call next');
    });

    it('should allow tester role to bypass subscription', async () => {
      const { res, next } = await runMiddleware(requireSubscription, TestScenarios.tester);

      assert.equal(res.redirectUrl, null, 'Should not redirect');
      assert.equal(next.called, true, 'Should call next for tester');
    });

    it('should allow Staff role to bypass subscription', async () => {
      const { res, next } = await runMiddleware(requireSubscription, TestScenarios.staff);

      assert.equal(res.redirectUrl, null, 'Should not redirect');
      assert.equal(next.called, true, 'Should call next for Staff');
    });

    it('should allow admin role to bypass subscription', async () => {
      const { res, next } = await runMiddleware(requireSubscription, TestScenarios.admin);

      assert.equal(res.redirectUrl, null, 'Should not redirect');
      assert.equal(next.called, true, 'Should call next for admin');
    });

    it('should redirect expired subscribers to /subscribe', async () => {
      const { res, next } = await runMiddleware(requireSubscription, TestScenarios.expiredSubscriber);

      assert.equal(res.redirectUrl, '/subscribe', 'Should redirect expired subscriber');
      assert.equal(next.called, false, 'Should not call next');
    });

    it('should allow access in development mode', async () => {
      process.env.NODE_ENV = 'development';
      const { res, next } = await runMiddleware(requireSubscription, TestScenarios.freeUser);

      assert.equal(res.redirectUrl, null, 'Should not redirect in dev mode');
      assert.equal(next.called, true, 'Should call next in dev mode');
    });
  });

  describe('requireSubscriptionAPI()', () => {
    it('should return 401 if user is not logged in', async () => {
      const { res, next } = await runMiddleware(requireSubscriptionAPI, TestScenarios.anonymous);

      assert.equal(res.statusCode, 401, 'Should return 401');
      assert.equal(res.jsonData?.error, 'Authentication required');
      assert.equal(next.called, false, 'Should not call next');
    });

    it('should allow access for users with active subscription', async () => {
      const { res, next } = await runMiddleware(requireSubscriptionAPI, TestScenarios.subscriber);

      assert.equal(res.statusCode, 200, 'Should not change status');
      assert.equal(next.called, true, 'Should call next');
    });

    it('should return 403 for free users', async () => {
      const { res, next } = await runMiddleware(requireSubscriptionAPI, TestScenarios.freeUser);

      assert.equal(res.statusCode, 403, 'Should return 403');
      assert.equal(res.jsonData?.error, 'Subscription required');
      assert.equal(next.called, false, 'Should not call next');
    });

    it('should include upgrade message in 403 response', async () => {
      const { res } = await runMiddleware(requireSubscriptionAPI, TestScenarios.freeUser);

      assert.ok(res.jsonData?.message?.includes('/subscribe'), 'Should include subscribe URL in message');
    });

    it('should allow tester role to bypass subscription', async () => {
      const { res, next } = await runMiddleware(requireSubscriptionAPI, TestScenarios.tester);

      assert.equal(res.statusCode, 200, 'Should not change status for tester');
      assert.equal(next.called, true, 'Should call next for tester');
    });

    it('should allow Staff role to bypass subscription', async () => {
      const { res, next } = await runMiddleware(requireSubscriptionAPI, TestScenarios.staff);

      assert.equal(res.statusCode, 200, 'Should not change status for Staff');
      assert.equal(next.called, true, 'Should call next for Staff');
    });

    it('should allow admin role to bypass subscription', async () => {
      const { res, next } = await runMiddleware(requireSubscriptionAPI, TestScenarios.admin);

      assert.equal(res.statusCode, 200, 'Should not change status for admin');
      assert.equal(next.called, true, 'Should call next for admin');
    });

    it('should allow access in development mode', async () => {
      process.env.NODE_ENV = 'development';
      const { res, next } = await runMiddleware(requireSubscriptionAPI, TestScenarios.freeUser);

      assert.equal(res.statusCode, 200, 'Should not return error in dev mode');
      assert.equal(next.called, true, 'Should call next in dev mode');
    });
  });

  describe('hasSubscription()', () => {
    it('should return false for anonymous users', () => {
      const req = createMockRequest(TestScenarios.anonymous);
      assert.equal(hasSubscription(req as any), false, 'Anonymous should not have subscription');
    });

    it('should return true for subscribers', () => {
      const req = createMockRequest(TestScenarios.subscriber);
      assert.equal(hasSubscription(req as any), true, 'Subscriber should have subscription');
    });

    it('should return false for free users', () => {
      const req = createMockRequest(TestScenarios.freeUser);
      assert.equal(hasSubscription(req as any), false, 'Free user should not have subscription');
    });

    it('should return true for tester role', () => {
      const req = createMockRequest(TestScenarios.tester);
      assert.equal(hasSubscription(req as any), true, 'Tester should have subscription access');
    });

    it('should return true for Staff role', () => {
      const req = createMockRequest(TestScenarios.staff);
      assert.equal(hasSubscription(req as any), true, 'Staff should have subscription access');
    });

    it('should return true for admin role', () => {
      const req = createMockRequest(TestScenarios.admin);
      assert.equal(hasSubscription(req as any), true, 'Admin should have subscription access');
    });

    it('should return true in development mode', () => {
      process.env.NODE_ENV = 'development';
      const req = createMockRequest(TestScenarios.freeUser);
      assert.equal(hasSubscription(req as any), true, 'Dev mode should grant subscription access');
    });

    it('should return false for expired subscribers', () => {
      const req = createMockRequest(TestScenarios.expiredSubscriber);
      assert.equal(hasSubscription(req as any), false, 'Expired subscriber should not have access');
    });
  });
});

describe('Subscription Access Matrix', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  // Test all user types against both middleware functions
  const testCases = [
    { scenario: 'anonymous', expectAccess: false, expectApiCode: 401 },
    { scenario: 'freeUser', expectAccess: false, expectApiCode: 403 },
    { scenario: 'subscriber', expectAccess: true, expectApiCode: 200 },
    { scenario: 'tester', expectAccess: true, expectApiCode: 200 },
    { scenario: 'staff', expectAccess: true, expectApiCode: 200 },
    { scenario: 'admin', expectAccess: true, expectApiCode: 200 },
    { scenario: 'expiredSubscriber', expectAccess: false, expectApiCode: 403 },
  ];

  testCases.forEach(({ scenario, expectAccess, expectApiCode }) => {
    it(`${scenario}: page access = ${expectAccess}, API code = ${expectApiCode}`, async () => {
      const sessionData = TestScenarios[scenario as keyof typeof TestScenarios];

      // Test page middleware
      const pageResult = await runMiddleware(requireSubscription, sessionData);
      assert.equal(
        pageResult.next.called,
        expectAccess,
        `Page access for ${scenario} should be ${expectAccess}`
      );

      // Test API middleware
      const apiResult = await runMiddleware(requireSubscriptionAPI, sessionData);
      assert.equal(
        apiResult.res.statusCode === 200 ? apiResult.next.called : false,
        expectAccess,
        `API access for ${scenario} should be ${expectAccess}`
      );
    });
  });
});
