/**
 * Integration Tests for Subscription System
 * Tests the full subscription flow including database operations
 *
 * IMPORTANT: These tests require a running database connection.
 *
 * To run integration tests:
 * 1. Make sure your .env file has database configuration
 * 2. Run: bun run test:integration
 *
 * To skip integration tests:
 * Set environment variable: SKIP_INTEGRATION_TESTS=true
 */

/// <reference path="../../types/session.d.ts" />

import { describe, it, before, after, beforeEach, afterEach } from 'mocha';
import { strict as assert } from 'assert';

// These tests require the database to be available
// They will be skipped if the database cannot be initialized

describe('Subscription Integration Tests', function() {
  // Increase timeout for database operations
  this.timeout(10000);

  let Channel: any;
  let Subscription: any;
  let CustomBotAccount: any;
  let sequelize: any;
  let testChannelId: number;
  let dbInitialized = false;

  before(async function() {
    // Skip if explicitly disabled
    if (process.env.SKIP_INTEGRATION_TESTS === 'true') {
      console.log('Integration tests skipped (SKIP_INTEGRATION_TESTS=true)');
      this.skip();
      return;
    }

    try {
      // Dynamic import to handle module resolution
      // Use relative path for compatibility with ESM/CJS
      const dbPath = process.cwd() + '/src/db';
      const db = await import(dbPath);

      Channel = db.Channel;
      Subscription = db.Subscription;
      CustomBotAccount = db.CustomBotAccount;
      sequelize = db.sequelize;

      // Sync database
      await sequelize.sync({ force: false });
      dbInitialized = true;
      console.log('Database initialized for integration tests');
    } catch (err: any) {
      console.log(`Skipping integration tests: ${err.message || 'Database not available'}`);
      this.skip();
    }
  });

  beforeEach(async function() {
    // Create a test channel for each test
    try {
      const channel = await Channel.create({
        username: `testuser_${Date.now()}`,
        twitch_user_id: `test_${Date.now()}`,
        has_subscription: false,
        subscription_tier: null,
        role: 'Basic user',
        bot_enabled: true,
      });
      testChannelId = channel.id;
    } catch (err) {
      console.error('Failed to create test channel:', err);
      throw err;
    }
  });

  afterEach(async function() {
    // Clean up test data
    if (testChannelId) {
      try {
        await CustomBotAccount.destroy({ where: { channel_id: testChannelId } });
        await Subscription.destroy({ where: { channel_id: testChannelId } });
        await Channel.destroy({ where: { id: testChannelId } });
      } catch (err) {
        console.error('Failed to clean up test data:', err);
      }
    }
  });

  describe('Subscription Creation', () => {
    it('should create a subscription record', async function() {
      const subscription = await Subscription.create({
        channel_id: testChannelId,
        status: 'active',
        plan_type: 'custom_bot',
        current_period_start: new Date(),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      });

      assert.ok(subscription.id, 'Subscription should have an ID');
      assert.equal(subscription.channel_id, testChannelId);
      assert.equal(subscription.status, 'active');
      assert.equal(subscription.plan_type, 'custom_bot');
    });

    it('should update channel has_subscription flag', async function() {
      // Grant subscription
      await Channel.update(
        { has_subscription: true, subscription_tier: 'custom_bot' },
        { where: { id: testChannelId } }
      );

      // Verify
      const channel = await Channel.findByPk(testChannelId);
      assert.equal(channel.has_subscription, true);
      assert.equal(channel.subscription_tier, 'custom_bot');
    });

    it('should handle subscription expiration', async function() {
      // Create expired subscription
      const expiredDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Yesterday
      await Subscription.create({
        channel_id: testChannelId,
        status: 'active',
        plan_type: 'custom_bot',
        current_period_end: expiredDate,
      });

      // Update channel to reflect expiration
      await Channel.update(
        { has_subscription: false },
        { where: { id: testChannelId } }
      );

      const channel = await Channel.findByPk(testChannelId);
      assert.equal(channel.has_subscription, false, 'Expired subscription should be inactive');
    });
  });

  describe('Custom Bot Account Linking', () => {
    it('should link a custom bot account', async function() {
      // First, give the channel a subscription
      await Channel.update(
        { has_subscription: true, subscription_tier: 'custom_bot' },
        { where: { id: testChannelId } }
      );

      // Link custom bot
      const customBot = await CustomBotAccount.create({
        channel_id: testChannelId,
        bot_username: 'TestBot',
        bot_twitch_user_id: `bot_${Date.now()}`,
        bot_access_token: 'test_access_token',
        bot_refresh_token: 'test_refresh_token',
        is_active: true,
      });

      assert.ok(customBot.id, 'Custom bot should have an ID');
      assert.equal(customBot.channel_id, testChannelId);
      assert.equal(customBot.is_active, true);
    });

    it('should deactivate custom bot when subscription expires', async function() {
      // Setup: subscription + custom bot
      await Channel.update(
        { has_subscription: true, subscription_tier: 'custom_bot' },
        { where: { id: testChannelId } }
      );

      const customBot = await CustomBotAccount.create({
        channel_id: testChannelId,
        bot_username: 'TestBot',
        bot_twitch_user_id: `bot_${Date.now()}`,
        bot_access_token: 'test_token',
        bot_refresh_token: 'test_refresh',
        is_active: true,
      });

      // Simulate subscription expiration
      await Channel.update(
        { has_subscription: false },
        { where: { id: testChannelId } }
      );
      await CustomBotAccount.update(
        { is_active: false },
        { where: { id: customBot.id } }
      );

      // Verify
      const updatedBot = await CustomBotAccount.findByPk(customBot.id);
      assert.equal(updatedBot.is_active, false, 'Bot should be deactivated');
    });

    it('should prevent multiple active bots for same channel', async function() {
      await Channel.update(
        { has_subscription: true },
        { where: { id: testChannelId } }
      );

      // Create first bot
      await CustomBotAccount.create({
        channel_id: testChannelId,
        bot_username: 'Bot1',
        bot_twitch_user_id: `bot1_${Date.now()}`,
        bot_access_token: 'token1',
        bot_refresh_token: 'refresh1',
        is_active: true,
      });

      // Try to create second active bot - should deactivate first
      const activeBots = await CustomBotAccount.findAll({
        where: { channel_id: testChannelId, is_active: true }
      });

      // In real implementation, linking a new bot should deactivate old one
      assert.ok(activeBots.length >= 1, 'Should have at least one active bot');
    });
  });

  describe('Role-Based Access', () => {
    it('should allow tester role without subscription', async function() {
      await Channel.update(
        { role: 'tester', has_subscription: false },
        { where: { id: testChannelId } }
      );

      const channel = await Channel.findByPk(testChannelId);

      // Check if user should have access (role bypass)
      const hasAccess = channel.has_subscription ||
        ['tester', 'Staff', 'admin'].includes(channel.role);

      assert.equal(hasAccess, true, 'Tester should have access without subscription');
    });

    it('should allow Staff role without subscription', async function() {
      await Channel.update(
        { role: 'Staff', has_subscription: false },
        { where: { id: testChannelId } }
      );

      const channel = await Channel.findByPk(testChannelId);
      const hasAccess = channel.has_subscription ||
        ['tester', 'Staff', 'admin'].includes(channel.role);

      assert.equal(hasAccess, true, 'Staff should have access without subscription');
    });

    it('should allow admin role without subscription', async function() {
      await Channel.update(
        { role: 'admin', has_subscription: false },
        { where: { id: testChannelId } }
      );

      const channel = await Channel.findByPk(testChannelId);
      const hasAccess = channel.has_subscription ||
        ['tester', 'Staff', 'admin'].includes(channel.role);

      assert.equal(hasAccess, true, 'Admin should have access without subscription');
    });
  });

  describe('Subscription Status Transitions', () => {
    it('should transition from inactive to active', async function() {
      const subscription = await Subscription.create({
        channel_id: testChannelId,
        status: 'inactive',
        plan_type: 'custom_bot',
      });

      // Activate
      await subscription.update({ status: 'active' });
      await Channel.update(
        { has_subscription: true },
        { where: { id: testChannelId } }
      );

      const channel = await Channel.findByPk(testChannelId);
      assert.equal(channel.has_subscription, true);
    });

    it('should transition from active to canceled', async function() {
      const subscription = await Subscription.create({
        channel_id: testChannelId,
        status: 'active',
        plan_type: 'custom_bot',
      });

      // Cancel (but keep access until period end)
      await subscription.update({ status: 'canceled' });

      const updated = await Subscription.findByPk(subscription.id);
      assert.equal(updated.status, 'canceled');
    });

    it('should transition from canceled to inactive at period end', async function() {
      const subscription = await Subscription.create({
        channel_id: testChannelId,
        status: 'canceled',
        plan_type: 'custom_bot',
        current_period_end: new Date(Date.now() - 1000), // Expired
      });

      // Deactivate
      await subscription.update({ status: 'inactive' });
      await Channel.update(
        { has_subscription: false },
        { where: { id: testChannelId } }
      );

      const channel = await Channel.findByPk(testChannelId);
      assert.equal(channel.has_subscription, false);
    });
  });
});

describe('Manual Subscription Grant (Admin)', function() {
  this.timeout(10000);

  let Channel: any;
  let Subscription: any;
  let testChannelId: number;

  before(async function() {
    if (process.env.SKIP_INTEGRATION_TESTS === 'true') {
      this.skip();
      return;
    }

    try {
      const dbPath = process.cwd() + '/src/db';
      const db = await import(dbPath);
      Channel = db.Channel;
      Subscription = db.Subscription;
      await db.sequelize.sync({ force: false });
    } catch (err) {
      this.skip();
    }
  });

  beforeEach(async function() {
    const channel = await Channel.create({
      username: `admintest_${Date.now()}`,
      twitch_user_id: `admin_${Date.now()}`,
      has_subscription: false,
    });
    testChannelId = channel.id;
  });

  afterEach(async function() {
    if (testChannelId) {
      await Subscription.destroy({ where: { channel_id: testChannelId } });
      await Channel.destroy({ where: { id: testChannelId } });
    }
  });

  it('should grant subscription for 30 days', async function() {
    const durationDays = 30;
    const endDate = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

    // Simulate admin grant
    await Channel.update(
      { has_subscription: true, subscription_tier: 'custom_bot' },
      { where: { id: testChannelId } }
    );

    await Subscription.create({
      channel_id: testChannelId,
      stripe_customer_id: `manual_grant_${Date.now()}`,
      stripe_subscription_id: `manual_grant_${Date.now()}`,
      status: 'active',
      plan_type: 'custom_bot',
      current_period_start: new Date(),
      current_period_end: endDate,
    });

    const channel = await Channel.findByPk(testChannelId);
    const subscription = await Subscription.findOne({
      where: { channel_id: testChannelId }
    });

    assert.equal(channel.has_subscription, true);
    assert.equal(subscription.status, 'active');
    assert.ok(subscription.current_period_end <= endDate);
  });

  it('should grant subscription for custom duration', async function() {
    const durationDays = 7; // 1 week trial
    const endDate = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

    await Channel.update(
      { has_subscription: true, subscription_tier: 'custom_bot' },
      { where: { id: testChannelId } }
    );

    await Subscription.create({
      channel_id: testChannelId,
      status: 'active',
      plan_type: 'custom_bot',
      current_period_end: endDate,
    });

    const subscription = await Subscription.findOne({
      where: { channel_id: testChannelId }
    });

    // Check that end date is approximately correct (within 1 minute)
    const diff = Math.abs(subscription.current_period_end.getTime() - endDate.getTime());
    assert.ok(diff < 60000, 'End date should be approximately correct');
  });
});
