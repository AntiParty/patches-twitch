# Implementation Plan: Paid Twitch Account Service MVP

**Status:** Ready for Development  
**Target:** Beta Testing Release  
**Last Updated:** 2026-01-23

## Overview

This plan outlines the implementation of a paid subscription service that allows users to link their own custom Twitch bot accounts. This enables the bot to respond in their chat using their custom account instead of the default bot account.

---

## Phase 1: Database Schema & Models

### 1.1 Create Subscription Model

**File:** `src/db.ts`

Add new model for tracking subscriptions:

```typescript
class Subscription extends Model {
  declare id: number;
  declare channel_id: number; // FK to Channel
  declare stripe_customer_id: string; // Stripe customer ID
  declare stripe_subscription_id: string; // Stripe subscription ID
  declare status: string; // active, canceled, past_due, etc.
  declare plan_type: string; // 'custom_bot' for now
  declare current_period_start: Date;
  declare current_period_end: Date;
  declare created_at: Date;
  declare updated_at: Date;
}
```

### 1.2 Create CustomBotAccount Model

**File:** `src/db.ts`

Add new model for custom bot accounts:

```typescript
class CustomBotAccount extends Model {
  declare id: number;
  declare channel_id: number; // FK to Channel (owner)
  declare bot_username: string; // Custom bot username
  declare bot_twitch_user_id: string; // Custom bot Twitch ID
  declare bot_access_token: string; // Custom bot OAuth token
  declare bot_refresh_token: string; // Custom bot refresh token
  declare bot_token_expires_at: Date; // Token expiration
  declare is_active: boolean; // Whether to use this bot
  declare created_at: Date;
  declare updated_at: Date;
}
```

### 1.3 Update Channel Model

**File:** `src/db.ts`

Add subscription-related fields:

```typescript
// Add to Channel model
declare;
has_subscription: boolean;
declare;
subscription_tier: string | null; // 'custom_bot', 'premium', etc.
```

---

## Phase 2: Stripe Integration

### 2.1 Install Stripe SDK

```bash
bun add stripe
bun add -d @types/stripe
```

### 2.2 Create Stripe Service

**File:** `src/services/stripe.service.ts`

```typescript
import Stripe from "stripe";

export class StripeService {
  private stripe: Stripe;

  constructor() {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2024-12-18.acacia",
    });
  }

  // Create customer
  async createCustomer(email: string, username: string);

  // Create subscription
  async createSubscription(customerId: string, priceId: string);

  // Cancel subscription
  async cancelSubscription(subscriptionId: string);

  // Handle webhook events
  async handleWebhook(event: Stripe.Event);
}
```

### 2.3 Environment Variables

**File:** `.env`

Add:

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID_CUSTOM_BOT=price_...
```

---

## Phase 3: Authentication & OAuth Flow

### 3.1 Custom Bot OAuth Route

**File:** `src/routes/user/subscription.routes.ts`

Create new route for custom bot OAuth:

```typescript
// Initiate custom bot OAuth
router.get("/link-custom-bot", requireUser, requireSubscription, (req, res) => {
  // Redirect to Twitch OAuth with custom state
});

// Custom bot OAuth callback
router.get("/link-custom-bot/callback", requireUser, async (req, res) => {
  // Exchange code for tokens
  // Store in CustomBotAccount table
  // Link to user's channel
});
```

### 3.2 Subscription Middleware

**File:** `src/middleware/subscription.middleware.ts`

```typescript
export function requireSubscription(req, res, next) {
  if (!req.session.user?.has_subscription) {
    return res.redirect("/subscribe");
  }
  next();
}

export function requireSubscriptionAPI(req, res, next) {
  if (!req.session.user?.has_subscription) {
    return res.status(403).json({ error: "Subscription required" });
  }
  next();
}
```

---

## Phase 4: Payment & Subscription Routes

### 4.1 Subscription Management Routes

**File:** `src/routes/user/subscription.routes.ts`

```typescript
// View subscription page
GET / subscribe;

// Create checkout session
POST / api / subscribe / create - checkout - session;

// Subscription success callback
GET / subscribe / success;

// Subscription cancel callback
GET / subscribe / cancel;

// Manage subscription (cancel, update)
GET / subscription / manage;
POST / api / subscription / cancel;
```

### 4.2 Stripe Webhook Handler

**File:** `src/routes/webhooks/stripe.routes.ts`

```typescript
POST / webhooks / stripe;

// Handle events:
// - checkout.session.completed
// - customer.subscription.created
// - customer.subscription.updated
// - customer.subscription.deleted
// - invoice.payment_succeeded
// - invoice.payment_failed
```

---

## Phase 5: Bot Service Integration

### 5.1 Update Bot Manager

**File:** `src/botManager.ts`

Modify to support custom bot accounts:

```typescript
// Check if channel has custom bot
const customBot = await CustomBotAccount.findOne({
  where: { channel_id: channel.id, is_active: true },
});

if (customBot) {
  // Use custom bot credentials
  // Connect custom bot to channel's chat
} else {
  // Use default bot
}
```

### 5.2 Token Refresh for Custom Bots

**File:** `src/util/tokenRefresh.ts`

Add support for refreshing custom bot tokens:

```typescript
export async function refreshCustomBotToken(customBot: CustomBotAccount);
```

### 5.3 Multi-Bot Connection Manager

**File:** `src/util/customBotManager.ts`

Create new service to manage multiple bot connections:

```typescript
class CustomBotManager {
  private bots: Map<number, TwitchClient>; // channel_id -> bot client

  async connectCustomBot(channelId: number);
  async disconnectCustomBot(channelId: number);
  async sendMessage(channelId: number, message: string);
}
```

---

## Phase 6: Frontend UI

### 6.1 Subscription Landing Page

**File:** `frontend/views/subscribe.html`

Create beautiful landing page with:

- Feature comparison (Free vs Custom Bot)
- Pricing ($5/month)
- Benefits list
- "Subscribe Now" CTA button
- FAQ section

### 6.2 Custom Bot Setup Dashboard

**File:** `frontend/views/custom-bot-setup.html`

Create setup wizard:

1. Welcome screen
2. "Link Your Custom Bot Account" button
3. OAuth flow
4. Success confirmation
5. Test bot connection

### 6.3 Subscription Management Page

**File:** `frontend/views/subscription-manage.html`

Add to user dashboard:

- Current subscription status
- Billing information
- Cancel subscription option
- Custom bot status (connected/disconnected)
- Re-link bot option

### 6.4 Update User Dashboard

**File:** `frontend/views/user-dashboard.ejs`

Add subscription section:

- Show subscription status badge
- Link to manage subscription
- Link to custom bot setup (if subscribed)

---

## Phase 7: Testing Features

### 7.1 Tester Access Control

**File:** `src/middleware/subscription.middleware.ts`

Add tester bypass:

```typescript
export function requireSubscriptionOrTester(req, res, next) {
  const isTester =
    req.session.user?.role === "Tester" ||
    req.session.user?.role === "Staff" ||
    req.session.user?.role === "Admin";

  if (req.session.user?.has_subscription || isTester) {
    return next();
  }

  return res.redirect("/subscribe");
}
```

### 7.2 Tester Dashboard Features

Add to admin panel:

- List of testers
- Grant/revoke tester access
- View custom bot connections
- Test bot functionality

---

## Phase 8: Security & Compliance

### 8.1 Token Encryption

**File:** `src/util/encryption.ts`

Encrypt custom bot tokens at rest:

```typescript
export function encryptToken(token: string): string;
export function decryptToken(encrypted: string): string;
```

### 8.2 Rate Limiting

Add rate limits for:

- Subscription creation (5/hour per IP)
- Custom bot linking (3/hour per user)
- Webhook endpoints (100/minute)

### 8.3 Audit Logging

**File:** `src/models/AuditLog.ts`

Log all subscription events:

- Subscription created
- Subscription canceled
- Custom bot linked
- Custom bot unlinked
- Payment succeeded/failed

---

## Phase 9: Documentation

### 9.1 User Documentation

**File:** `docs/CUSTOM_BOT_GUIDE.md`

Create guide covering:

- How to create a custom Twitch account
- How to subscribe
- How to link custom bot
- Troubleshooting
- FAQ

### 9.2 API Documentation

**File:** `docs/API_SUBSCRIPTION.md`

Document all subscription endpoints

### 9.3 Admin Documentation

**File:** `docs/ADMIN_SUBSCRIPTION.md`

Document admin features for managing subscriptions

---

## Phase 10: Deployment Checklist

### Pre-Launch

- [ ] Set up Stripe account (production mode)
- [ ] Create product and pricing in Stripe
- [ ] Set up webhook endpoint in Stripe dashboard
- [ ] Configure environment variables
- [ ] Test payment flow end-to-end
- [ ] Test custom bot connection
- [ ] Test token refresh
- [ ] Test subscription cancellation
- [ ] Review Twitch API compliance
- [ ] Review data privacy compliance

### Beta Testing

- [ ] Grant tester access to 5-10 users
- [ ] Monitor error logs
- [ ] Collect feedback
- [ ] Test edge cases (expired tokens, payment failures, etc.)
- [ ] Performance testing (multiple custom bots)

### Launch

- [ ] Update main website with subscription info
- [ ] Announce to users
- [ ] Monitor Stripe dashboard
- [ ] Monitor bot connections
- [ ] Set up alerts for payment failures

---

## Technical Considerations

### Bot Connection Limits

- Twitch allows ~100 connections per IP
- Monitor connection count
- Implement connection pooling if needed

### Token Management

- Refresh tokens before expiration
- Handle revoked tokens gracefully
- Secure token storage (encryption)

### Payment Edge Cases

- Handle failed payments
- Handle subscription downgrades
- Handle refunds
- Handle chargebacks

### Scalability

- Database indexes on subscription lookups
- Cache active subscriptions
- Efficient bot connection management

---

## Success Metrics

### Key Metrics to Track

- Subscription conversion rate
- Churn rate
- Average subscription lifetime
- Custom bot connection success rate
- Payment failure rate
- Support ticket volume

### Analytics Events

- Subscription page viewed
- Checkout initiated
- Subscription completed
- Custom bot linked
- Custom bot disconnected
- Subscription canceled

---

## Future Enhancements (Post-MVP)

1. **Multiple Bot Accounts** - Allow linking multiple bots
2. **Bot Customization** - Custom response templates per bot
3. **Analytics Dashboard** - Bot usage statistics
4. **Team Subscriptions** - Share subscription with team members
5. **Annual Billing** - Discounted annual plans
6. **Enterprise Tier** - Higher limits, priority support

---

## Estimated Timeline

- **Phase 1-2:** Database & Stripe Setup - 1 day
- **Phase 3-4:** Auth & Payment Routes - 2 days
- **Phase 5:** Bot Integration - 2 days
- **Phase 6:** Frontend UI - 2 days
- **Phase 7-8:** Testing & Security - 1 day
- **Phase 9:** Documentation - 1 day
- **Phase 10:** Testing & Launch - 2 days

**Total:** ~11 days for MVP

---

## Questions to Resolve

1. **Pricing:** Confirm $5/month pricing
2. **Trial Period:** Offer free trial? (7 days?)
3. **Refund Policy:** What's the refund policy?
4. **Bot Requirements:** Minimum account age for custom bots?
5. **Support:** How to handle support for custom bot issues?
6. **Limits:** Any limits on custom bot usage? (messages/hour, etc.)

---

## Next Steps

1. Review and approve this plan
2. Set up Stripe test account
3. Begin Phase 1 implementation
4. Create project board for tracking
5. Set up staging environment for testing
