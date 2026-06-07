# Operations Drops, Sidebar, and Bot Restart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw Drops editor, implement the Icon Rail Hybrid navigation, and make custom-bot unlinking restart the correct bot identity immediately.

**Architecture:** Keep Drops in the existing JSON file but normalize writes through a pure helper. Add a BotManager lifecycle method that fully stops a channel, waits for client removal, starts from current database state, and verifies IRC authentication; expose it through a dedicated Control API route used by unlinking.

**Tech Stack:** TypeScript, Express, Sequelize/SQLite, Bun, Mocha, vanilla HTML/CSS/JavaScript.

---

### Task 1: Drops Payload Contract

**Files:**
- Create: `src/services/dropsConfig.service.ts`
- Create: `src/tests/unit/dropsConfig.test.ts`
- Modify: `src/routes/admin/drops.routes.ts`

- [ ] Write failing tests for supported global fields, normalized drop rows, blank-row removal, and invalid/excessive payload rejection.
- [ ] Run `bunx mocha --require ts-node/register --require tsconfig-paths/register src/tests/unit/dropsConfig.test.ts --timeout 5000` and confirm failure because the service does not exist.
- [ ] Implement `normalizeDropsConfig(input)` with bounded strings and a maximum of 50 rows.
- [ ] Route GET responses and POST writes through the normalized `{ lastUpdated, featuredImage, drops }` contract.
- [ ] Rerun the focused test and confirm it passes.

### Task 2: Bot Restart Lifecycle

**Files:**
- Create: `src/services/botIdentityRestart.service.ts`
- Create: `src/tests/unit/botIdentityRestart.test.ts`
- Modify: `src/botManager.ts`
- Modify: `src/botService.ts`
- Modify: `src/routes/user/subscription.routes.ts`

- [ ] Write a failing test proving restart stops the stale client, reloads channel state, starts through BotManager, and reports failure unless the resulting client is authenticated.
- [ ] Run the focused test and confirm failure because the restart helper does not exist.
- [ ] Implement a dependency-injected restart helper with bounded polling for client removal/authentication.
- [ ] Add `BotManager.restartBotFromCurrentState(username)` using the helper.
- [ ] Add `POST /restart-channel-bot` to the Control API and return non-2xx when authentication fails.
- [ ] Update unlinking to call the dedicated endpoint and report the actual result.
- [ ] Rerun focused tests and confirm they pass.

### Task 3: Structured Drops Editor

**Files:**
- Modify: `frontend/views/admin-dashboard.html`
- Modify: `src/tests/unit/adminDashboardShell.test.ts`

- [ ] Add failing shell assertions for global settings, image upload, drop rows, Add Item, Delete, and removal of the JSON textarea.
- [ ] Run the dashboard shell test and confirm the new assertions fail.
- [ ] Build the Global Settings and Active Drops panels.
- [ ] Implement safe DOM-based row rendering, add/remove controls, upload-to-featured-image behavior, and one Save Changes action.
- [ ] Rerun the dashboard shell test and confirm it passes.

### Task 4: Icon Rail Hybrid Navigation

**Files:**
- Modify: `frontend/views/admin-dashboard.html`
- Modify: `src/tests/unit/adminDashboardShell.test.ts`

- [ ] Add failing assertions for inline navigation SVGs and the icon-tile active state.
- [ ] Replace navigation dots with accessible inline SVG icons on desktop and mobile.
- [ ] Apply the approved compact rail, red active icon tile, muted inactive rows, hover, and keyboard focus styling.
- [ ] Verify desktop and mobile role visibility remains unchanged.

### Task 5: Verification

**Files:**
- Modify only files needed for defects found during verification.

- [ ] Run `bun run build`.
- [ ] Run focused Drops, restart, dashboard, and security tests.
- [ ] Run all non-baseline unit tests and `bun run test:integration`.
- [ ] Run `git diff --check`.
- [ ] Start the app from `main` and verify the Drops editor and navigation at desktop and mobile widths.
- [ ] Commit the implementation without staging the existing `stats.json` change.
