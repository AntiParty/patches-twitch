# Admin Operations Console Design

## Objective

Replace the current admin dashboard with a secure, black-themed operations console focused on bot reliability, user and channel administration, selected-channel messaging, Drops management, and sanitized audit activity.

The rebuild must improve operational visibility without exposing Twitch tokens, OAuth values, secrets, raw database records, raw logs, request headers, IP addresses, chat message contents, or unrestricted server controls.

## Product Direction

The console uses a summary-first information hierarchy:

1. Show whether FinalsRS is healthy.
2. Surface active warnings and automatic recoveries.
3. Show durable command usage and current service throughput.
4. Provide deeper bot-health diagnostics.
5. Keep administrative actions in dedicated user, channel, messaging, Drops, and audit views.

The visual direction is a pure-black interface with restrained red accents, high-contrast typography, compact summary cards, and soft area charts. The interface must be usable on desktop and mobile.

## Roles And Permissions

### Admin

Admins can access:

- Operations overview
- Bot health
- Channel management
- User management
- Role changes
- User bans and unbans
- Subscription grants and revocations
- Selected-channel bot messaging
- Drops management
- Sanitized audit activity

### Staff

Staff can access only Drops management.

Staff must not receive operations data or UI controls for users, channels, messaging, audit activity, subscriptions, or bot health.

### Messaging Rules

Bot messaging is admin-only.

- At least one channel must be selected.
- There is no send-to-all option.
- Each selected channel must be validated against an allowlisted channel identifier from the server.
- Message length and batch size must be bounded.
- Sends must be rate-limited.
- The audit record stores the actor, target channel identifiers, timestamp, and outcome.
- The audit record must not store message contents.

## Navigation

Admin navigation:

```text
Overview
Bot Health
Channels
Users
Message Bot
Drops
Audit Activity
```

Staff navigation:

```text
Drops
```

Desktop uses a persistent left sidebar. Mobile uses a bottom navigation bar for primary destinations and a compact overflow menu for secondary admin views. Interactive controls must have touch-friendly hit areas.

## Overview

The Overview is an operational summary, not a general analytics dashboard.

### Primary Metrics

- Bot and Control API status
- Connected channels versus expected channels
- Durable all-time command usage
- Command usage today
- Command failure rate
- Bot latency

### Throughput

A soft area chart shows recent combined operational activity. Supporting values below the chart show:

- Incoming chat messages per minute
- Outgoing chat messages per minute
- Commands per minute

The default range is 24 hours. Supported aggregate ranges are 24 hours, 7 days, 30 days, and all time where the metric is meaningful.

### Operational Status

The overview shows:

- Active incidents
- Channels currently reconnecting
- Recent automatic recoveries
- EventSub health
- Leaderboard cache freshness
- Control API health

Each panel has its own loading, empty, stale, and error states. A failed panel must not blank the rest of the page.

## Bot Health

The Bot Health view contains deeper read-only diagnostics:

- Web process health
- Bot Control API health
- Process uptime
- Bot latency history
- Connected and expected channel counts
- IRC reconnect and recovery counts
- EventSub connection health
- Cache refresh status, duration, and age
- Incoming and outgoing chat throughput
- Command throughput and failure rate

Health data includes an `observedAt` timestamp. The frontend marks data stale when the configured freshness threshold is exceeded.

No process restart, deployment, pause, resume, environment editing, or token-refresh controls are exposed.

## Command Analytics

Existing `CommandUsage` history remains the source for detailed command execution records.

The system exposes:

- Durable all-time command count
- Today, 7-day, and 30-day command counts
- Success and failure totals
- Failure rate
- Average response time
- Usage grouped by active command
- Usage trend over time

Deleted or renamed commands remain included in durable historical totals. They are excluded from the active-command leaderboard unless their command name is currently registered by the bot.

Analytics writes are best-effort and must never block command execution.

## Operational Events

Add sanitized operational event tracking for:

- IRC connected
- IRC disconnected
- IRC reconnect started
- IRC recovered
- EventSub connected
- EventSub disconnected
- Cache refresh succeeded
- Cache refresh failed
- Control API health check succeeded
- Control API health check failed

An operational event may contain:

- Event type
- Severity
- Timestamp
- Sanitized channel identifier where relevant
- Duration in milliseconds
- Numeric attempt count
- Sanitized outcome or reason code

An operational event must not contain:

- Access or refresh tokens
- OAuth authorization data
- Cookies or session identifiers
- Environment values
- IP addresses
- Request headers
- Chat usernames
- Chat or bot-message contents
- Raw exception objects, stacks, or upstream response bodies

Operational event writes are best-effort and must not interrupt reconnects, EventSub handling, cache updates, or health checks.

## API Boundary

The frontend consumes purpose-built admin operations endpoints. Responses use explicit view-model construction and field allowlists.

No endpoint may return a Sequelize model directly.

The operations API returns only the values needed by the current view, such as:

```ts
interface OperationsOverview {
  observedAt: string;
  status: "operational" | "degraded" | "outage" | "unknown";
  bot: {
    controlApiReachable: boolean;
    latencyMs: number | null;
    uptimeSeconds: number | null;
  };
  channels: {
    connected: number;
    expected: number;
    reconnecting: number;
  };
  commands: {
    allTime: number;
    today: number;
    failureRate: number;
  };
  throughput: Array<{
    timestamp: string;
    chatIn: number;
    chatOut: number;
    commands: number;
  }>;
  services: {
    eventSubHealthy: boolean;
    cacheAgeSeconds: number | null;
  };
  incidents: SanitizedOperationalEvent[];
}
```

User and channel endpoints return explicit administrative summaries. Token columns and other secret-bearing fields are omitted at query and serialization boundaries rather than masked in frontend code.

## Removed Surfaces

Remove the following from both the dashboard and browser-facing admin router:

- Generic database browser and CRUD editor
- Raw log viewer
- Bot-token refresh control
- Token previews
- Deployment control
- Process restart control
- Pause and resume stubs
- API-key input and storage
- Environment or configuration editing
- Generic model serialization
- Send-to-all messaging
- Duplicate general analytics panels that are replaced by the operations views

Removing a control from HTML is insufficient. Its browser-facing route must also be removed or made unreachable from the admin application.

## Audit Activity

Administrative actions produce sanitized audit records for:

- Role changed
- User banned
- User unbanned
- Subscription granted
- Subscription revoked
- Bot message requested
- Drops configuration changed
- Drops asset uploaded

Audit records contain:

- Actor username
- Actor role
- Action type
- Sanitized target identifier
- Timestamp
- Success or failure outcome

Audit records do not contain token values, secrets, message contents, raw request bodies, or raw error objects.

The dashboard displays these structured records instead of raw application logs.

## Drops Management

Drops management remains available to staff and admins.

The rebuild preserves:

- Reading the Drops configuration
- Updating validated Drops entries
- Uploading supported image types
- Recording sanitized audit events

Uploads retain size, extension, MIME-type, and generated-filename validation. Staff access must not grant access to any other operations endpoint.

## Reliability

- Panel requests fail independently.
- API responses include observation timestamps.
- The frontend visibly labels stale health data.
- Metrics queries use bounded ranges and indexed timestamp columns.
- Live Control API calls use short timeouts and return `unknown` rather than hanging the dashboard.
- Analytics and operational-event writes are non-blocking best-effort work.
- Empty datasets render intentional empty states.
- Sensitive values are omitted at the data-access boundary.

## Responsive Interface

The interface uses:

- Pure black page background
- Near-black cards and navigation surfaces
- Restrained FinalsRS red accents
- Green and amber reserved for operational state
- Tabular numerals for changing metrics
- Balanced headings and readable body wrapping
- Soft area charts with subtle fills and grid lines
- Minimum 40-by-40-pixel interactive hit areas
- Explicit transition properties rather than `transition: all`
- Desktop sidebar navigation
- Mobile bottom navigation and stacked panels

On mobile:

- Summary metrics use a two-column grid.
- Warnings appear before charts.
- Diagnostic panels stack vertically.
- Tables become compact cards or horizontally scroll only where necessary.
- Destructive actions require confirmation and remain clearly separated from routine actions.

## Testing

### Security Tests

- Operations responses never contain known token-field names.
- User and channel responses never serialize secret-bearing model fields.
- Removed database, log, deploy, restart, pause, resume, and token-refresh endpoints return `404` or an equivalent unavailable response.
- Staff cannot access admin operations endpoints.
- Staff can access Drops endpoints.
- Bot messaging rejects missing channel selections and send-to-all requests.
- Audit records omit message contents and raw request bodies.

### Analytics Tests

- Existing command rows contribute to all-time totals.
- Deleted commands remain in all-time totals.
- Deleted commands are absent from active-command rankings.
- Success, failure, and range aggregates are correct.
- Operational-event records accept allowlisted fields and discard forbidden data.

### Integration Tests

- Overview aggregation combines Control API health and persisted metrics.
- Control API timeout produces an `unknown` or degraded status.
- Messaging validates channels and records a sanitized result.
- User role, ban, and subscription actions create audit records.
- Drops updates remain available to staff.

### Interface Tests

- Admin navigation contains the approved views.
- Staff navigation contains only Drops.
- Removed controls and sensitive labels are absent.
- Overview panels render loading, empty, stale, and error states.
- Desktop and mobile layouts render at representative breakpoints.
- The soft area chart is readable without relying solely on color.

## Migration Strategy

Implement incrementally:

1. Add security regression tests around current admin responses and routes.
2. Add sanitized operational event storage and aggregation.
3. Add the purpose-built operations API.
4. Add strict user, channel, messaging, Drops, and audit view models.
5. Build the new responsive dashboard against those APIs.
6. Remove dangerous UI controls and browser-facing routes.
7. Remove or redirect duplicate admin analytics surfaces after parity is verified.
8. Run build, unit, integration, and responsive browser verification.

Existing user-facing dashboard behavior and bot command behavior remain outside this redesign.

## Success Criteria

- An admin can assess service health in under ten seconds.
- An admin can identify reconnecting channels and recent recoveries.
- Command usage is durable and visible across useful time ranges.
- Admins can manage users and selected channels without exposure to secret fields.
- Bot messages can only be sent to explicitly selected channels.
- Staff can manage Drops and cannot access other operations data.
- Tokens and other secrets cannot appear in admin API responses.
- Dangerous server and database controls no longer exist in the browser-facing admin surface.
- The dashboard is polished and usable on desktop and mobile.
