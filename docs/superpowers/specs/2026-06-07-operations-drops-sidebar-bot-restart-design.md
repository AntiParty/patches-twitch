# Operations Drops, Navigation, and Bot Restart Design

## Scope

Improve the existing Operations console in three focused areas:

1. Replace the raw Drops JSON editor with a structured editor.
2. Redesign desktop and mobile navigation using the approved Icon Rail Hybrid direction.
3. Fix custom-bot unlinking so the correct bot identity reconnects immediately without a server restart.

No production database migration or schema change is required.

## Drops Editor

The existing `frontend/public/drops.json` file remains the source of truth so the public Drops page and `!drops` command remain compatible.

The staff-facing editor will provide:

- Global settings for `lastUpdated` and `featuredImage`.
- An image upload control that writes the returned URL into `featuredImage`.
- A list of editable active Drops.
- Each row contains `name`, `category`, and `duration`.
- Add Item and Delete controls.
- One Save Changes action for the full configuration.
- Empty-state guidance when no Drops exist.

The browser will build a validated `{ lastUpdated, featuredImage, drops }` payload. The server will normalize strings, reject malformed or excessive entries, and write only the supported fields.

There is no archive workflow. Staff remove obsolete Drops directly.

## Navigation

The approved Icon Rail Hybrid direction will replace dot markers with inline SVG icons.

- Desktop sidebar uses a compact brand lockup, section grouping, and icon-plus-label rows.
- The active section uses a red icon tile and a restrained dark surface.
- Inactive rows use muted icons and text with clear hover and keyboard focus states.
- Mobile bottom navigation uses the same icons and active-state language.
- Role visibility remains unchanged: Drops is staff-accessible; operations and management remain admin-only.

No external icon package is required.

## Bot Identity Restart

Unlinking a custom bot will continue to set the existing `CustomBotAccount.is_active` field to `false`.

The web process will then call a dedicated Control API endpoint that:

1. Finds the channel from existing database state.
2. Fully removes the current IRC client and its timers/cached custom credentials.
3. Re-reads channel and active custom-bot state.
4. Starts the bot through `BotManager.startBotForUser`, which selects the correct identity.
5. Returns success only when the resulting IRC client authenticates.

This replaces use of the misleading `/reconnect-custom-bot` endpoint for unlinking. Linking may continue using that endpoint until separately renamed.

The route will return an actionable failure when the Control API or Twitch authentication fails. It will not claim that the default bot is active when it is not.

## Safety

- No tokens are returned to the browser or written to logs.
- No database fields are deleted.
- No schema changes or migrations are introduced.
- Drops writes are restricted to supported fields and bounded list sizes.
- Existing staff/admin authorization and CSRF protection remain in force.

## Verification

- Unit tests for Drops payload normalization and rejection.
- Unit or integration coverage proving restart selection ignores an inactive custom-bot record.
- Route test proving unlink reports failed swaps accurately.
- Dashboard shell tests for structured Drops controls and SVG navigation.
- TypeScript build, relevant unit tests, and integration tests.
- Browser verification at desktop and mobile widths.
