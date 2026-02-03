/**
 * Test Premium Command
 * Allows testers/staff/admins to test premium features
 *
 * Usage:
 *   !testpremium status              - Check your premium status
 *   !testpremium simulate <user>     - Simulate premium for a user (staff only)
 *   !testpremium grant <user> [days] - Grant test subscription (admin only)
 *   !testpremium revoke <user>       - Revoke test subscription (admin only)
 *   !testpremium info                - Show premium feature info
 */

import logger from '@/util/logger';
import { Channel, Subscription, CustomBotAccount } from '@/db';

// Minimum role required to use this command
export const minRole = "tester";

// Role hierarchy for permission checks
const ROLE_HIERARCHY: Record<string, number> = {
  'Basic user': 0,
  'tester': 1,
  'analyst': 2,
  'Staff': 3,
  'admin': 4,
};

function hasRole(userRole: string, requiredRole: string): boolean {
  return (ROLE_HIERARCHY[userRole] || 0) >= (ROLE_HIERARCHY[requiredRole] || 0);
}

export const execute = async (
  ctx: { say: (msg: string) => Promise<void>, user: string },
  channelName: string,
  message: string,
  tags: any,
  args: string[]
) => {
  try {
    const sender = ctx.user;
    const displayName = tags?.['display-name'] || sender;

    // Get sender's channel record
    const senderChannel = await Channel.findOne({ where: { username: sender.toLowerCase() } });
    if (!senderChannel) {
      await ctx.say(`@${displayName} You are not registered in the system.`);
      return;
    }

    const senderRole = senderChannel.role || 'Basic user';
    const subCommand = args[0]?.toLowerCase();

    switch (subCommand) {
      case 'status': {
        await handleStatus(ctx, displayName, senderChannel);
        break;
      }

      case 'simulate': {
        if (!hasRole(senderRole, 'Staff')) {
          await ctx.say(`@${displayName} You need Staff role to simulate premium.`);
          return;
        }
        const targetUser = args[1]?.toLowerCase().replace('@', '');
        if (!targetUser) {
          await ctx.say(`@${displayName} Usage: !testpremium simulate <username>`);
          return;
        }
        await handleSimulate(ctx, displayName, targetUser);
        break;
      }

      case 'grant': {
        if (!hasRole(senderRole, 'admin')) {
          await ctx.say(`@${displayName} You need admin role to grant subscriptions.`);
          return;
        }
        const targetUser = args[1]?.toLowerCase().replace('@', '');
        const days = parseInt(args[2]) || 30;
        if (!targetUser) {
          await ctx.say(`@${displayName} Usage: !testpremium grant <username> [days]`);
          return;
        }
        await handleGrant(ctx, displayName, targetUser, days);
        break;
      }

      case 'revoke': {
        if (!hasRole(senderRole, 'admin')) {
          await ctx.say(`@${displayName} You need admin role to revoke subscriptions.`);
          return;
        }
        const targetUser = args[1]?.toLowerCase().replace('@', '');
        if (!targetUser) {
          await ctx.say(`@${displayName} Usage: !testpremium revoke <username>`);
          return;
        }
        await handleRevoke(ctx, displayName, targetUser);
        break;
      }

      case 'info': {
        await handleInfo(ctx, displayName);
        break;
      }

      case 'check': {
        // Check another user's status (staff only)
        if (!hasRole(senderRole, 'Staff')) {
          await ctx.say(`@${displayName} You need Staff role to check other users.`);
          return;
        }
        const targetUser = args[1]?.toLowerCase().replace('@', '');
        if (!targetUser) {
          await ctx.say(`@${displayName} Usage: !testpremium check <username>`);
          return;
        }
        const targetChannel = await Channel.findOne({ where: { username: targetUser } });
        if (!targetChannel) {
          await ctx.say(`@${displayName} User ${targetUser} not found.`);
          return;
        }
        await handleStatus(ctx, displayName, targetChannel, targetUser);
        break;
      }

      default: {
        await ctx.say(`@${displayName} Commands: status, info, check <user>, simulate <user>, grant <user> [days], revoke <user>`);
      }
    }
  } catch (err) {
    logger.error("Error executing testpremium command:", err);
    await ctx.say(`@${tags?.['display-name'] || ctx.user} An error occurred.`);
  }
};

async function handleStatus(
  ctx: { say: (msg: string) => Promise<void> },
  displayName: string,
  channel: any,
  targetName?: string
) {
  const name = targetName || channel.username;
  const hasSub = channel.has_subscription;
  const tier = channel.subscription_tier || 'none';
  const role = channel.role || 'Basic user';

  // Check for custom bot
  const customBot = await CustomBotAccount.findOne({
    where: { channel_id: channel.id, is_active: true }
  });

  // Check for subscription record
  const subscription = await Subscription.findOne({
    where: { channel_id: channel.id }
  });

  let statusMsg = `@${displayName} ${targetName ? name + "'s" : 'Your'} Premium Status: `;
  statusMsg += `Subscribed: ${hasSub ? 'Yes' : 'No'} | `;
  statusMsg += `Tier: ${tier} | `;
  statusMsg += `Role: ${role}`;

  if (customBot) {
    statusMsg += ` | Custom Bot: ${customBot.bot_username}`;
  }

  if (subscription) {
    statusMsg += ` | Status: ${subscription.status}`;
    if (subscription.current_period_end) {
      const daysLeft = Math.ceil((new Date(subscription.current_period_end).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      statusMsg += ` | Days Left: ${daysLeft}`;
    }
  }

  // Check if they have access (via subscription OR role)
  const hasAccess = hasSub || ['tester', 'Staff', 'admin'].includes(role);
  statusMsg += ` | Has Premium Access: ${hasAccess ? 'Yes' : 'No'}`;

  await ctx.say(statusMsg);
}

async function handleSimulate(
  ctx: { say: (msg: string) => Promise<void> },
  displayName: string,
  targetUser: string
) {
  const targetChannel = await Channel.findOne({ where: { username: targetUser } });

  if (!targetChannel) {
    await ctx.say(`@${displayName} User ${targetUser} not found.`);
    return;
  }

  // Check current status
  const hasSub = targetChannel.has_subscription;
  const role = targetChannel.role || 'Basic user';
  const hasAccess = hasSub || ['tester', 'Staff', 'admin'].includes(role);

  await ctx.say(
    `@${displayName} Simulating premium for ${targetUser}: ` +
    `Current access: ${hasAccess ? 'GRANTED' : 'DENIED'} | ` +
    `Subscription: ${hasSub ? 'Active' : 'Inactive'} | ` +
    `Role bypass: ${['tester', 'Staff', 'admin'].includes(role) ? 'Yes (' + role + ')' : 'No'}`
  );
}

async function handleGrant(
  ctx: { say: (msg: string) => Promise<void> },
  displayName: string,
  targetUser: string,
  days: number
) {
  const targetChannel = await Channel.findOne({ where: { username: targetUser } });

  if (!targetChannel) {
    await ctx.say(`@${displayName} User ${targetUser} not found.`);
    return;
  }

  const endDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  // Update channel
  await targetChannel.update({
    has_subscription: true,
    subscription_tier: 'custom_bot',
  });

  // Create or update subscription record
  const [subscription, created] = await Subscription.findOrCreate({
    where: { channel_id: targetChannel.id },
    defaults: {
      channel_id: targetChannel.id,
      stripe_customer_id: `test_grant_${Date.now()}`,
      stripe_subscription_id: `test_grant_${Date.now()}`,
      status: 'active',
      plan_type: 'custom_bot',
      current_period_start: new Date(),
      current_period_end: endDate,
    }
  });

  if (!created) {
    await subscription.update({
      status: 'active',
      current_period_start: new Date(),
      current_period_end: endDate,
    });
  }

  logger.info(`[TestPremium] ${displayName} granted ${days} days premium to ${targetUser}`);
  await ctx.say(`@${displayName} Granted ${days} days of premium to ${targetUser} (expires: ${endDate.toLocaleDateString()})`);
}

async function handleRevoke(
  ctx: { say: (msg: string) => Promise<void> },
  displayName: string,
  targetUser: string
) {
  const targetChannel = await Channel.findOne({ where: { username: targetUser } });

  if (!targetChannel) {
    await ctx.say(`@${displayName} User ${targetUser} not found.`);
    return;
  }

  // Update channel
  await targetChannel.update({
    has_subscription: false,
  });

  // Update subscription record
  await Subscription.update(
    { status: 'inactive' },
    { where: { channel_id: targetChannel.id } }
  );

  // Deactivate custom bot if any
  await CustomBotAccount.update(
    { is_active: false },
    { where: { channel_id: targetChannel.id } }
  );

  logger.info(`[TestPremium] ${displayName} revoked premium from ${targetUser}`);
  await ctx.say(`@${displayName} Revoked premium from ${targetUser}`);
}

async function handleInfo(
  ctx: { say: (msg: string) => Promise<void> },
  displayName: string
) {
  await ctx.say(
    `@${displayName} Premium Features: Custom Bot Account ($5/mo) - ` +
    `Link your own Twitch bot for branded chat experience. ` +
    `Testers, Staff, and Admins get free access for testing.`
  );
}

export const aliases = ["testpremium", "tpremium", "premiumtest"];
