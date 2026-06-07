# Chat Prediction Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add chat-managed Twitch Channel Points prediction presets that broadcasters can configure and broadcasters/moderators can start, resolve, or cancel after the broadcaster grants `channel:manage:predictions`.

**Architecture:** Persist only reusable presets in SQLite. Put validation and storage behavior in a preset service, Twitch OAuth/API behavior in a prediction service with an injected HTTP boundary, and leave chat command modules responsible only for parsing, permission checks, and short replies. Twitch remains the source of truth for the current active or locked prediction.

**Tech Stack:** Bun, TypeScript, Sequelize/SQLite, Axios, Mocha, Node `assert`, Twitch Helix API.

---

## File Map

- Modify `src/util/twitchScopes.ts`: expose the canonical broadcaster OAuth scope set.
- Modify `src/routes/auth.routes.ts`: use the canonical scope set for login and reauthorization.
- Modify `src/db.ts`: define and export `PredictionPreset`.
- Create `src/scripts/migrate_prediction_presets.ts`: idempotent production migration.
- Create `src/services/predictionPermissions.service.ts`: broadcaster/moderator badge policy.
- Create `src/services/predictionPreset.service.ts`: parsing, validation, filtering, and persistence.
- Create `src/services/twitchPredictions.service.ts`: scope validation, token refresh, current-state lookup, create, resolve, and cancel.
- Create `src/commands/preset.ts`: broadcaster-only preset management.
- Create `src/commands/start.ts`: broadcaster/moderator prediction creation.
- Create `src/commands/end.ts`: broadcaster/moderator prediction resolution.
- Create `src/commands/cancel.ts`: broadcaster/moderator prediction cancellation.
- Modify `src/commands/help.ts`: keep generic prediction-management commands out of the viewer-facing command wall.
- Create focused unit and integration tests under `src/tests`.

### Task 1: Canonical Broadcaster OAuth Scopes

**Files:**
- Modify: `src/util/twitchScopes.ts`
- Modify: `src/routes/auth.routes.ts`
- Modify: `src/tests/unit/twitchScopes.test.ts`

- [ ] **Step 1: Write the failing OAuth scope test**

Add a test that imports `getBroadcasterOAuthScopes()` and expects:

```ts
[
  'channel:moderate',
  'user:read:chat',
  'user:bot',
  'channel:bot',
  'user:read:subscriptions',
  'channel:manage:predictions',
]
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```powershell
bun run test:unit -- --grep "Twitch OAuth scopes"
```

Expected: failure because `getBroadcasterOAuthScopes` does not exist.

- [ ] **Step 3: Implement the scope helper and route usage**

Add:

```ts
export function getBroadcasterOAuthScopes(): string[] {
  return [
    'channel:moderate',
    'user:read:chat',
    'user:bot',
    'channel:bot',
    'user:read:subscriptions',
    'channel:manage:predictions',
  ];
}
```

Replace the hardcoded normal-login scope string in `auth.routes.ts` with:

```ts
const scope = encodeURIComponent(getBroadcasterOAuthScopes().join(' '));
```

The `/reauth` route continues using the same `getAuthUrl()` path, so production reauthorization automatically requests the new scope.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run the same command and expect all OAuth scope tests to pass.

- [ ] **Step 5: Commit**

```powershell
git add src/util/twitchScopes.ts src/routes/auth.routes.ts src/tests/unit/twitchScopes.test.ts
git commit -m "feat: request Twitch prediction scope"
```

### Task 2: Prediction Preset Persistence And Migration

**Files:**
- Modify: `src/db.ts`
- Create: `src/scripts/migrate_prediction_presets.ts`
- Create: `src/tests/integration/predictionPresetModel.test.ts`

- [ ] **Step 1: Write the failing model integration test**

Cover:

```ts
const first = await PredictionPreset.create({
  channel_id: channel.id,
  alias: 'ranked',
  title: 'Will we win?',
  outcomes_json: JSON.stringify(['Yes', 'No']),
  duration_seconds: 120,
  created_at: new Date(),
  updated_at: new Date(),
});
assert.equal(first.alias, 'ranked');

await assert.rejects(
  PredictionPreset.create({ ...sameChannelAndAlias }),
  /unique/i,
);
```

Also prove the same alias may exist for a different channel.

- [ ] **Step 2: Run the focused test and confirm RED**

```powershell
bun run test:integration -- --grep "PredictionPreset model"
```

Expected: compile/import failure because `PredictionPreset` does not exist.

- [ ] **Step 3: Define and export the Sequelize model**

Use fields:

```ts
id: INTEGER primary key auto increment
channel_id: INTEGER not null references Channels.id
alias: STRING(24) not null
title: STRING(45) not null
outcomes_json: TEXT not null
duration_seconds: INTEGER not null default 120
created_at: DATE not null default NOW
updated_at: DATE not null default NOW
```

Add indexes:

```ts
{ unique: true, fields: ['channel_id', 'alias'] }
{ fields: ['channel_id'] }
```

- [ ] **Step 4: Add the idempotent migration**

The migration script exports `migratePredictionPresets(queryInterface)` without importing `db.ts`, calls `queryInterface.showAllTables()`, creates `PredictionPresets` only when absent, and adds the same indexes. Its direct-execution block dynamically imports `sequelize` from `db.ts` only after the helper is defined, avoiding a circular import when `db.ts` calls the helper.

Also call this migration from `runMigrations()` after the `Channels` table exists, so both production processes converge safely through idempotent checks.

- [ ] **Step 5: Run the focused integration test and confirm GREEN**

Run the command from Step 2 and expect the model tests to pass.

- [ ] **Step 6: Commit**

```powershell
git add src/db.ts src/scripts/migrate_prediction_presets.ts src/tests/integration/predictionPresetModel.test.ts
git commit -m "feat: persist prediction presets"
```

### Task 3: Preset Parsing, Validation, Filtering, And Upsert

**Files:**
- Create: `src/services/predictionPreset.service.ts`
- Create: `src/tests/unit/predictionPreset.test.ts`

- [ ] **Step 1: Write failing parser and validation tests**

Specify the public API:

```ts
parsePresetAddArgs(args: string[]): ParsedPresetInput
validatePresetInput(input: ParsedPresetInput): ValidatedPresetInput
validatePresetContent(input: ValidatedPresetInput, deps?: PresetContentDependencies): Promise<void>
upsertPredictionPreset(channelId: number, input: ValidatedPresetInput): Promise<'created' | 'updated'>
```

Test:

- `ranked | Win this match? | Yes | No | 120` parses duration 120.
- A nonnumeric final field is treated as an outcome and duration defaults to 120.
- Alias normalization uses lowercase and rejects whitespace or characters outside `^[a-z0-9][a-z0-9_-]{0,23}$`.
- Titles accept 1-45 characters.
- Outcomes accept 2-5 unique case-insensitive values of 1-25 characters.
- Duration accepts 30-1800 seconds.
- A failed overwrite does not call the repository upsert.

- [ ] **Step 2: Run parser tests and confirm RED**

```powershell
bun run test:unit -- --grep "Prediction preset"
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement pure parsing and validation**

Define named constants:

```ts
export const DEFAULT_PREDICTION_DURATION_SECONDS = 120;
export const MIN_PREDICTION_DURATION_SECONDS = 30;
export const MAX_PREDICTION_DURATION_SECONDS = 1800;
export const MAX_PREDICTION_TITLE_LENGTH = 45;
export const MAX_PREDICTION_OUTCOME_LENGTH = 25;
export const MAX_PRESET_OUTCOMES = 5;
```

Join `args` with spaces, require pipe separators, trim every segment, and classify the final segment as duration only when `/^\d+$/` matches.

- [ ] **Step 4: Add failing content-filter tests**

Inject filter and warning dependencies so tests can force each field category to fail without mutating module-global environment state:

```ts
validatePresetContent(input, {
  isBlocked: text => text === 'blocked',
  warn: async details => warnings.push(details),
});
```

Assert alias, title, and outcomes are checked; the first rejection stops persistence; warning metadata excludes the rejected text itself.

- [ ] **Step 5: Implement content validation and atomic persistence**

The production `isBlocked` adapter combines:

```ts
matchesBlockRegex(text) ||
containsBlockedPhrase(text) ||
containsBlockedWord(text)
```

`savePredictionPreset()` performs parse, structural validation, content validation, then `PredictionPreset.upsert()`. It sends a Discord warning containing channel, actor, command, and field category, but not the rejected value.

- [ ] **Step 6: Run focused unit tests and confirm GREEN**

Run the Step 2 command and expect all preset tests to pass.

- [ ] **Step 7: Commit**

```powershell
git add src/services/predictionPreset.service.ts src/tests/unit/predictionPreset.test.ts
git commit -m "feat: validate prediction presets"
```

### Task 4: Twitch Predictions Domain Service

**Files:**
- Create: `src/services/twitchPredictions.service.ts`
- Create: `src/tests/unit/twitchPredictions.test.ts`

- [ ] **Step 1: Write failing scope and token ownership tests**

Build the service with injected dependencies:

```ts
createTwitchPredictionsService({
  request,
  validateToken,
  refreshAccessToken,
  decryptAccessToken,
  getBaseUrl,
  now,
})
```

Test:

- missing `channel:manage:predictions` throws `PredictionReauthRequiredError` with `${getBaseUrl()}/reauth`;
- token `user_id` mismatch throws a reauth-required domain error;
- successful validation is cached per channel/token for five minutes;
- changed token bypasses the old cache entry.

- [ ] **Step 2: Run the focused tests and confirm RED**

```powershell
bun run test:unit -- --grep "Twitch predictions service"
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement authorization and normalized domain types**

Export:

```ts
type TwitchPredictionStatus = 'ACTIVE' | 'LOCKED' | 'RESOLVED' | 'CANCELED';
interface TwitchPredictionOutcome { id: string; title: string; }
interface TwitchPrediction { id: string; title: string; status: TwitchPredictionStatus; outcomes: TwitchPredictionOutcome[]; }
```

Add stable error classes for reauth required, unavailable channel, active conflict, no active prediction, invalid outcome, and temporary Twitch failure.

- [ ] **Step 4: Write failing create/current/resolve/cancel tests**

Assert:

- current lookup chooses the newest `ACTIVE` or `LOCKED` item and ignores completed items;
- create sends `POST /helix/predictions` with broadcaster ID, title, outcome objects, and `prediction_window`;
- create refuses when current prediction exists;
- resolve accepts one-based number and case-insensitive exact text and sends `PATCH` with `RESOLVED`;
- invalid selection returns numbered choices without patching;
- cancel sends `PATCH` with `CANCELED`;
- 401 refreshes through existing `refreshAccessToken(channel)`, reloads the channel token, and retries once;
- missing-scope/auth mismatch never sets `auth_revoked`;
- affiliate/partner restriction maps to unavailable;
- 429/5xx map to temporary failure.

- [ ] **Step 5: Implement Helix operations**

Use `axios` through the injected request function. Load the current `Channel` row before every operation. Decrypt the stored token using an exported safe channel-token helper from `twitchUtils`; do not log plaintext or encrypted tokens.

`GET /helix/predictions` requests `first=20` and selects the first item with status `ACTIVE` or `LOCKED`, since Twitch sorts newest first.

- [ ] **Step 6: Run focused tests and confirm GREEN**

Run the Step 2 command and expect all service tests to pass.

- [ ] **Step 7: Commit**

```powershell
git add src/services/twitchPredictions.service.ts src/util/twitchUtils.ts src/tests/unit/twitchPredictions.test.ts
git commit -m "feat: integrate Twitch predictions API"
```

### Task 5: Shared Chat Permissions

**Files:**
- Create: `src/services/predictionPermissions.service.ts`
- Create: `src/tests/unit/predictionPermissions.test.ts`

- [ ] **Step 1: Write failing permission tests**

Test broadcaster recognition by badge and case-insensitive channel-name equality. Test moderator recognition from the IRC badge. Prove bot application roles do not grant permission.

- [ ] **Step 2: Run and confirm RED**

```powershell
bun run test:unit -- --grep "Prediction permissions"
```

- [ ] **Step 3: Implement**

Export:

```ts
isBroadcaster(ctxUser: string, channel: string, tags: Record<string, any>): boolean
canManagePredictionPresets(...): boolean
canOperatePredictions(...): boolean
```

Normalize `#` from channel names and accept badge values represented as string `"1"` or truthy parsed IRC values.

- [ ] **Step 4: Run and confirm GREEN**

Run the Step 2 command.

- [ ] **Step 5: Commit**

```powershell
git add src/services/predictionPermissions.service.ts src/tests/unit/predictionPermissions.test.ts
git commit -m "feat: enforce prediction chat permissions"
```

### Task 6: Chat Command Adapters

**Files:**
- Create: `src/commands/preset.ts`
- Create: `src/commands/start.ts`
- Create: `src/commands/end.ts`
- Create: `src/commands/cancel.ts`
- Modify: `src/commands/help.ts`
- Create: `src/tests/unit/predictionCommands.test.ts`

- [ ] **Step 1: Write failing command tests**

Invoke command `execute()` functions with fake `ctx.say`, tags, args, and injected service seams. Cover:

- only `p` subcommands are handled;
- preset management rejects moderators and accepts broadcaster;
- `add` reports created vs updated;
- `list`, `show`, and `delete` use channel-owned rows;
- start/end/cancel accept broadcaster or moderator;
- reauth errors include the production `/reauth` URL;
- invalid outcome replies with numbered choices;
- no active prediction and Twitch-unavailable errors receive clear short messages;
- replies use the incoming message ID.

- [ ] **Step 2: Run and confirm RED**

```powershell
bun run test:unit -- --grep "Prediction chat commands"
```

- [ ] **Step 3: Implement thin command modules**

Use the standard execute signature:

```ts
execute(ctx, channel, message, tags, args)
```

Each command validates `args[0]?.toLowerCase() === 'p'`, uses the shared permission helper, looks up the channel by sanitized name, delegates to services, and formats the domain result. No command stores active prediction state.

Each module also exports a dependency-injected command factory: `createPresetCommand(deps)`, `createStartCommand(deps)`, `createEndCommand(deps)`, or `createCancelCommand(deps)`. Its production `execute` export is created from the factory with real services, preserving the command loader contract while giving tests explicit seams.

- [ ] **Step 4: Hide generic namespaces from viewer help**

Add `preset`, `start`, `end`, and `cancel` to `HIDDEN_COMMANDS`; users discover these privileged commands through feature documentation rather than the general viewer command list.

- [ ] **Step 5: Run and confirm GREEN**

Run the Step 2 command and expect all command tests to pass.

- [ ] **Step 6: Commit**

```powershell
git add src/commands/preset.ts src/commands/start.ts src/commands/end.ts src/commands/cancel.ts src/commands/help.ts src/tests/unit/predictionCommands.test.ts
git commit -m "feat: add prediction chat commands"
```

### Task 7: Production Migration And Regression Verification

**Files:**
- Modify: `docs/COMMANDS.md`
- Modify: `.env.example` only if the existing `BASE_URL` guidance is insufficient

- [ ] **Step 1: Add command documentation**

Document exact examples, broadcaster/mod permissions, two-to-five outcome limit, 30-1800 second duration, default 120 seconds, overwrite behavior, content filtering, Affiliate/Partner requirement, and `/reauth` requirement.

- [ ] **Step 2: Run focused prediction tests**

```powershell
bun run test:unit -- --grep "Prediction|Twitch OAuth scopes"
bun run test:integration -- --grep "PredictionPreset"
```

Expected: all focused tests pass.

- [ ] **Step 3: Run the full suites**

```powershell
bun run test:unit
bun run test:integration
```

Expected: zero failures.

- [ ] **Step 4: Run the strict TypeScript build**

```powershell
bun run build
```

Expected: exit code 0.

- [ ] **Step 5: Inspect production migration idempotency**

Run the migration twice against a temporary SQLite database configured by the test harness and confirm the second run makes no schema changes and exits successfully.

- [ ] **Step 6: Commit documentation**

```powershell
git add docs/COMMANDS.md .env.example
git commit -m "docs: document prediction commands"
```

- [ ] **Step 7: Final diff review**

Confirm:

- no dashboard files changed;
- no active prediction state is persisted;
- normal commands do not call prediction scope validation;
- `stats.json` remains untouched;
- no tokens or rejected preset text are logged;
- all user-authored preset fields pass content validation before save and before create.
