# VPS failover and nightly backup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable a planned month-long swap of the canonical FinalsRR deployment from homelab to VPS, with nightly SQLite backups pulled back to the homelab via a header-auth'd HTTP endpoint.

**Architecture:** Add one new HTTP endpoint (`GET /internal/db-snapshot`) on the VPS web process that streams a fresh `VACUUM INTO`-snapshotted tar.gz of the SQLite DBs. Five bash scripts on the homelab orchestrate seed, swap-to, nightly pull (cron), swap-back, and break-glass restore. A marker file `data/.STANDBY` gates the pull cron so the entry can live in crontab permanently.

**Tech Stack:** Bun + TypeScript (existing), Express, sqlite3 (npm), `tar` (npm), winston (logger), POSIX bash, mocha for tests.

**Spec:** [`docs/superpowers/specs/2026-05-14-vps-failover-and-backup-design.md`](../specs/2026-05-14-vps-failover-and-backup-design.md)

**Platform note:** The TypeScript pieces (Tasks 1–4) can be developed and tested on the user's Windows dev box. The bash scripts (Tasks 6–11) are Linux-only and must be tested on the homelab or VPS after deployment via the existing `deploy.sh` flow.

---

### Task 1: Add `tar` npm dependency

**Files:**
- Modify: `package.json`
- Modify: `bun.lockb`

- [ ] **Step 1: Add `tar` to dependencies**

Run: `bun add tar@^7.4.3` (in `E:\patches-twitch\`)
Expected: `package.json` gains `"tar": "^7.4.3"` under `dependencies`, `bun.lockb` updates.

- [ ] **Step 2: Verify install**

Run: `bun run build`
Expected: tsc completes with no new errors.

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lockb
git commit -m "Add tar dep for snapshot streaming"
```

---

### Task 2: SQLite snapshot helper (TDD)

**Files:**
- Create: `src/util/sqliteSnapshot.ts`
- Create: `src/tests/unit/sqliteSnapshot.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/sqliteSnapshot.test.ts`:

```ts
import { describe, it } from 'mocha';
import { strict as assert } from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sqlite3 from 'sqlite3';

import { snapshotDb } from '@/util/sqliteSnapshot';

describe('snapshotDb', function () {
  this.timeout(5000);

  it('produces a consistent single-file snapshot of a SQLite database', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-test-'));
    const srcPath = path.join(tmpDir, 'src.sqlite');
    const dstPath = path.join(tmpDir, 'dst.sqlite');

    // Seed source DB
    await new Promise<void>((resolve, reject) => {
      const db = new sqlite3.Database(srcPath);
      db.serialize(() => {
        db.run('CREATE TABLE t (id INTEGER, name TEXT)', (err) => err && reject(err));
        db.run("INSERT INTO t VALUES (1, 'alice')", (err) => err && reject(err));
        db.close((err) => (err ? reject(err) : resolve()));
      });
    });

    await snapshotDb(srcPath, dstPath);

    assert.ok(fs.existsSync(dstPath), 'destination file should exist');
    assert.ok(!fs.existsSync(dstPath + '-wal'), 'no -wal sidecar');
    assert.ok(!fs.existsSync(dstPath + '-shm'), 'no -shm sidecar');

    // Verify contents readable
    const row: any = await new Promise((resolve, reject) => {
      const db = new sqlite3.Database(dstPath);
      db.get('SELECT id, name FROM t WHERE id = 1', (err, r) => {
        db.close();
        err ? reject(err) : resolve(r);
      });
    });
    assert.equal(row.id, 1);
    assert.equal(row.name, 'alice');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects when destination dir does not exist', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-test-'));
    const srcPath = path.join(tmpDir, 'src.sqlite');
    await new Promise<void>((resolve, reject) => {
      const db = new sqlite3.Database(srcPath);
      db.run('CREATE TABLE t (x INTEGER)', (err) => {
        db.close();
        err ? reject(err) : resolve();
      });
    });

    await assert.rejects(snapshotDb(srcPath, '/no/such/dir/dst.sqlite'));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `E:\patches-twitch\`): `bun run test:unit -- --grep "snapshotDb"`
Expected: FAIL with module-not-found for `@/util/sqliteSnapshot`.

- [ ] **Step 3: Implement the snapshot helper**

Create `src/util/sqliteSnapshot.ts`:

```ts
import sqlite3 from 'sqlite3';

/**
 * Produces a consistent single-file snapshot of a SQLite database using
 * `VACUUM INTO`. The destination file must not already exist. The source
 * may be actively used by other connections — VACUUM INTO is online-safe.
 */
export function snapshotDb(srcPath: string, dstPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(srcPath, sqlite3.OPEN_READWRITE, (openErr) => {
      if (openErr) return reject(openErr);

      const escaped = dstPath.replace(/'/g, "''");
      db.exec(`VACUUM INTO '${escaped}'`, (execErr) => {
        db.close((closeErr) => {
          if (execErr) return reject(execErr);
          if (closeErr) return reject(closeErr);
          resolve();
        });
      });
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:unit -- --grep "snapshotDb"`
Expected: PASS (2 passing).

- [ ] **Step 5: Commit**

```bash
git add src/util/sqliteSnapshot.ts src/tests/unit/sqliteSnapshot.test.ts
git commit -m "Add sqliteSnapshot helper (VACUUM INTO wrapper)"
```

---

### Task 3: Backup endpoint route file (TDD)

**Files:**
- Create: `src/routes/internal-backup.routes.ts`
- Create: `src/tests/integration/internal-backup.test.ts`

This task uses Mocha's `before`/`after` to spin up a temporary Express app and a real listening port. It does NOT mount the full `setupServer()` — it isolates the new router so the test stays focused.

- [ ] **Step 1: Write the failing integration test**

Create `src/tests/integration/internal-backup.test.ts`:

```ts
import { describe, it, before, after } from 'mocha';
import { strict as assert } from 'assert';
import express from 'express';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sqlite3 from 'sqlite3';
import * as tar from 'tar';

describe('GET /internal/db-snapshot', function () {
  this.timeout(15000);

  let server: http.Server;
  let port: number;
  let tmpDataDir: string;
  let prevCwd: string;

  const SECRET = 'test-secret-do-not-use-in-prod';

  before(async () => {
    // Create a fake data/ dir with three tiny SQLite DBs
    prevCwd = process.cwd();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'));
    tmpDataDir = path.join(root, 'data');
    fs.mkdirSync(tmpDataDir);
    for (const name of ['accounts', 'metrics', 'sessions']) {
      const p = path.join(tmpDataDir, `${name}.sqlite`);
      await new Promise<void>((resolve, reject) => {
        const db = new sqlite3.Database(p);
        db.run(`CREATE TABLE marker (name TEXT)`, (e) => {
          if (e) return reject(e);
          db.run(`INSERT INTO marker VALUES ('${name}')`, (e2) => {
            db.close((e3) => (e2 || e3 ? reject(e2 || e3) : resolve()));
          });
        });
      });
    }
    process.chdir(root); // route reads from data/ relative to cwd
    process.env.BACKUP_SECRET = SECRET;

    // Dynamic import AFTER env + cwd are set
    const mod = await import(prevCwd.replace(/\\/g, '/') + '/src/routes/internal-backup.routes');
    const router = mod.default;

    const app = express();
    app.use('/internal', router);

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        port = (server.address() as any).port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.chdir(prevCwd);
    delete process.env.BACKUP_SECRET;
  });

  it('returns 401 with missing secret', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/internal/db-snapshot`);
    assert.equal(res.status, 401);
  });

  it('returns 401 with wrong secret', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/internal/db-snapshot`, {
      headers: { 'X-Backup-Secret': 'nope' },
    });
    assert.equal(res.status, 401);
  });

  it('returns 200 + valid gzipped tar with correct secret', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/internal/db-snapshot`, {
      headers: { 'X-Backup-Secret': SECRET },
    });
    assert.equal(res.status, 200);

    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 0, 'response body should be non-empty');

    // Write to disk and use tar.t (list) to enumerate entries
    const tarPath = path.join(os.tmpdir(), `snap-test-${Date.now()}.tar.gz`);
    fs.writeFileSync(tarPath, buf);
    const names: string[] = [];
    await tar.t({ file: tarPath, onentry: (e: any) => names.push(String(e.path)) });
    fs.unlinkSync(tarPath);

    names.sort();
    assert.deepEqual(names, ['accounts.sqlite', 'metrics.sqlite', 'sessions.sqlite']);
  });

  it('returns 404 when BACKUP_SECRET env is empty (feature disabled)', async () => {
    delete process.env.BACKUP_SECRET;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/internal/db-snapshot`, {
        headers: { 'X-Backup-Secret': 'anything' },
      });
      assert.equal(res.status, 404);
    } finally {
      process.env.BACKUP_SECRET = SECRET;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:integration -- --grep "/internal/db-snapshot"`
Expected: FAIL with module-not-found for `src/routes/internal-backup.routes`.

- [ ] **Step 3: Implement the route**

Create `src/routes/internal-backup.routes.ts`:

```ts
/**
 * Internal backup endpoint.
 * Streams a fresh tar.gz of all SQLite DBs in data/.
 * Auth: X-Backup-Secret header must match process.env.BACKUP_SECRET (constant-time).
 * Disabled (404) when BACKUP_SECRET env is unset/empty.
 */
import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import * as tar from 'tar';

import logger from '@/util/logger';
import { snapshotDb } from '@/util/sqliteSnapshot';

const router = Router();

const DBS = ['accounts', 'metrics', 'sessions'] as const;

// Hand-rolled rate limiter (matches src/middleware/security.ts patterns).
// 10 requests per hour per IP, scoped to this route only.
const rlBuckets = new Map<string, { count: number; resetAt: number }>();
const RL_MAX = 10;
const RL_WINDOW_MS = 60 * 60 * 1000;

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const rec = rlBuckets.get(ip);
  if (!rec || now > rec.resetAt) {
    rlBuckets.set(ip, { count: 1, resetAt: now + RL_WINDOW_MS });
    return next();
  }
  rec.count++;
  if (rec.count > RL_MAX) {
    logger.warn(`[backup] rate limit exceeded for ${ip}`);
    res.status(429).json({ error: 'Too many requests' });
    return;
  }
  next();
}

function timingSafeStringEq(a: string, b: string): boolean {
  const ah = crypto.createHash('sha256').update(a).digest();
  const bh = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ah, bh);
}

router.get('/db-snapshot', rateLimit, async (req: Request, res: Response) => {
  const secret = process.env.BACKUP_SECRET;
  if (!secret) {
    // Feature disabled — pretend the route doesn't exist.
    res.status(404).end();
    return;
  }

  const provided = req.header('x-backup-secret');
  if (!provided || !timingSafeStringEq(provided, secret)) {
    logger.warn(`[backup] unauthorized request from ${req.ip}`);
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const startedAt = Date.now();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-'));
  try {
    for (const name of DBS) {
      const src = path.join(process.cwd(), 'data', `${name}.sqlite`);
      const dst = path.join(workDir, `${name}.sqlite`);
      if (!fs.existsSync(src)) {
        throw new Error(`source DB missing: ${src}`);
      }
      await snapshotDb(src, dst);
    }

    const iso = new Date().toISOString().replace(/[:.]/g, '-');
    res.status(200);
    res.setHeader('Content-Type', 'application/x-tar');
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Disposition', `attachment; filename="snapshot-${iso}.tar.gz"`);

    const stream = tar.c(
      { gzip: true, cwd: workDir },
      DBS.map((n) => `${n}.sqlite`)
    );

    let bytes = 0;
    stream.on('data', (c: Buffer) => (bytes += c.length));
    stream.on('end', () => {
      const durationMs = Date.now() - startedAt;
      logger.info(`[backup] snapshot served ip=${req.ip} bytes=${bytes} durationMs=${durationMs}`);
      fs.rm(workDir, { recursive: true, force: true }, () => {});
    });
    stream.on('error', (err) => {
      logger.error('[backup] tar stream error', err);
      fs.rm(workDir, { recursive: true, force: true }, () => {});
    });
    stream.pipe(res);
  } catch (err) {
    logger.error('[backup] snapshot failed', err);
    fs.rm(workDir, { recursive: true, force: true }, () => {});
    if (!res.headersSent) res.status(500).json({ error: 'snapshot failed' });
  }
});

export default router;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:integration -- --grep "/internal/db-snapshot"`
Expected: PASS (4 passing).

- [ ] **Step 5: Commit**

```bash
git add src/routes/internal-backup.routes.ts src/tests/integration/internal-backup.test.ts
git commit -m "Add /internal/db-snapshot backup endpoint"
```

---

### Task 4: Mount the route

**Files:**
- Modify: `src/routes/index.ts`

- [ ] **Step 1: Add the import and mount**

Edit `src/routes/index.ts`:

```ts
/**
 * Main Routes Index
 * Aggregates all application routes
 */
import { Router } from 'express';
import authRoutes from './auth.routes';
import publicRoutes from './public.routes';
import userRoutes from './user';
import adminRoutes from './admin';
import overlayRoutes from './overlay.routes';
import developerRoutes from './api/developer.routes';
import internalBackupRoutes from './internal-backup.routes';

const router = Router();

// Mount all route modules
router.use('/', authRoutes);                  // Twitch OAuth routes
router.use('/', publicRoutes);                // Public pages and health checks
router.use('/', userRoutes);                  // User dashboard and API
router.use('/', developerRoutes);             // Public Developer API (v1)
router.use('/admin', adminRoutes);            // Admin panel and API
router.use('/', overlayRoutes);               // Stream overlay routes
router.use('/internal', internalBackupRoutes); // Service-to-service backup endpoint (header-auth)

export default router;
```

- [ ] **Step 2: Build to confirm it compiles**

Run: `bun run build`
Expected: tsc succeeds with no errors.

- [ ] **Step 3: Manual smoke test**

Run in one shell: `$env:BACKUP_SECRET="testsecret"; bun run dev:server`
In another shell: `curl -i http://localhost:3000/internal/db-snapshot`
Expected: HTTP/1.1 401 (no header).
Then: `curl -i -H "X-Backup-Secret: testsecret" -o snap.tar.gz http://localhost:3000/internal/db-snapshot`
Expected: HTTP/1.1 200 + a `snap.tar.gz` file. Run `tar tzf snap.tar.gz` and verify it lists `accounts.sqlite`, `metrics.sqlite`, `sessions.sqlite`.
Stop the server.

- [ ] **Step 4: Commit**

```bash
git add src/routes/index.ts
git commit -m "Mount /internal backup route"
```

---

### Task 5: Node snapshot CLI helper (for bash scripts)

**Files:**
- Create: `scripts/_snapshot.mjs`

The bash scripts (`seed-vps.sh`, etc.) need a way to invoke `VACUUM INTO` without importing TypeScript. This is a standalone Node script that takes `--src` and `--dst` and runs the snapshot.

- [ ] **Step 1: Create the helper**

Create `scripts/_snapshot.mjs`:

```js
#!/usr/bin/env node
// Snapshot a SQLite DB via VACUUM INTO. Usage: node _snapshot.mjs --src=/path/in.sqlite --dst=/path/out.sqlite
import sqlite3pkg from 'sqlite3';

const sqlite3 = sqlite3pkg.verbose ? sqlite3pkg : sqlite3pkg.default || sqlite3pkg;

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.src || !args.dst) {
  console.error('usage: _snapshot.mjs --src=<path> --dst=<path>');
  process.exit(2);
}

const escaped = args.dst.replace(/'/g, "''");
const db = new sqlite3.Database(args.src, sqlite3.OPEN_READWRITE, (err) => {
  if (err) { console.error(err.message); process.exit(1); }
  db.exec(`VACUUM INTO '${escaped}'`, (e) => {
    db.close((ce) => {
      if (e) { console.error(e.message); process.exit(1); }
      if (ce) { console.error(ce.message); process.exit(1); }
    });
  });
});
```

- [ ] **Step 2: Smoke-test it (Windows or Linux)**

Run (from `E:\patches-twitch\`):
```powershell
node scripts/_snapshot.mjs --src=data/accounts.sqlite --dst=$env:TEMP/test-snap.sqlite
```
Expected: completes with no output, `$TEMP/test-snap.sqlite` exists and is a valid SQLite file.
Cleanup: delete the temp file.

- [ ] **Step 3: Commit**

```bash
git add scripts/_snapshot.mjs
git commit -m "Add _snapshot.mjs CLI helper for bash scripts"
```

---

### Task 6: Config template + gitignore updates

**Files:**
- Create: `scripts/backup-config.sh.example`
- Modify: `.gitignore`

- [ ] **Step 1: Create the example config**

Create `scripts/backup-config.sh.example`:

```bash
# Copy to scripts/backup-config.sh and fill in real values.
# This file is gitignored; do NOT commit secrets.

# Public URL of the VPS where the canonical app runs during failover.
VPS_URL="https://your-vps-domain.example"

# Shared secret. Must match BACKUP_SECRET in the VPS .env.
# Generate with: openssl rand -hex 32
BACKUP_SECRET="REPLACE_ME"

# Where to store nightly backups on the homelab.
BACKUP_ROOT="$HOME/backups/finalsrr"

# Production install path on the homelab (matches deploy.sh).
PROD_PATH="/home/antiparty/Desktop/FinalsRR"

# How many nightly snapshots to keep before pruning oldest.
RETENTION=14
```

- [ ] **Step 2: Update .gitignore**

Append to `.gitignore`:

```
# VPS failover scripts: secrets and seed artifacts
scripts/backup-config.sh
scripts/seed-output/
```

- [ ] **Step 3: Commit**

```bash
git add scripts/backup-config.sh.example .gitignore
git commit -m "Add backup-config template and gitignore entries"
```

---

### Task 7: `seed-vps.sh` (one-shot initial seed)

**Files:**
- Create: `scripts/seed-vps.sh`

- [ ] **Step 1: Create the script**

Create `scripts/seed-vps.sh`:

```bash
#!/usr/bin/env bash
# Initial-seed helper: stops homelab PM2, snapshots SQLite, produces a tarball
# the operator scps to the VPS by hand. Run once before swap-to-vps.sh.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$HERE/backup-config.sh"
if [ ! -f "$CONFIG" ]; then
  echo "error: $CONFIG not found. Copy backup-config.sh.example and fill it in." >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$CONFIG"

read -r -p "This will stop PM2 (finalsrr-server, finalsrr-bot) and snapshot SQLite. Continue? [y/N] " ans
case "$ans" in
  y|Y|yes|YES) ;;
  *) echo "aborted."; exit 1 ;;
esac

echo "[seed] stopping PM2..."
pm2 stop finalsrr-server finalsrr-bot || true

TS="$(date -u +%Y%m%d_%H%M%SZ)"
OUT_DIR="$HERE/seed-output/$TS"
mkdir -p "$OUT_DIR"

echo "[seed] snapshotting databases into $OUT_DIR ..."
cd "$PROD_PATH"
for db in accounts metrics sessions; do
  SRC="$PROD_PATH/data/${db}.sqlite"
  DST="$OUT_DIR/${db}.sqlite"
  if [ ! -f "$SRC" ]; then
    echo "warn: $SRC missing, skipping" >&2
    continue
  fi
  node "$HERE/_snapshot.mjs" --src="$SRC" --dst="$DST"
done

TARBALL="$HERE/seed-output/seed-${TS}.tar.gz"
echo "[seed] creating tarball $TARBALL ..."
tar czf "$TARBALL" -C "$OUT_DIR" .

echo ""
echo "[seed] Done. Next steps:"
echo ""
echo "  1) scp \"$TARBALL\" vps:~/patches-twitch/data/"
echo "  2) On the VPS:"
echo "       cd ~/patches-twitch/data"
echo "       tar xzf seed-${TS}.tar.gz"
echo "       pm2 restart all"
echo "  3) Point DNS at the VPS."
echo "  4) On homelab: ./scripts/swap-to-vps.sh"
echo ""
echo "NOTE: PM2 on the homelab is currently STOPPED. Do not start it back up"
echo "      until you have completed the swap-back at end of month."
```

- [ ] **Step 2: Make executable + commit**

```bash
chmod +x scripts/seed-vps.sh
git add scripts/seed-vps.sh
git update-index --chmod=+x scripts/seed-vps.sh
git commit -m "Add seed-vps.sh for one-shot initial seed to VPS"
```

---

### Task 8: `swap-to-vps.sh`

**Files:**
- Create: `scripts/swap-to-vps.sh`

- [ ] **Step 1: Create the script**

Create `scripts/swap-to-vps.sh`:

```bash
#!/usr/bin/env bash
# Flip homelab into standby. After this, VPS is canonical.
# Idempotent: safe to re-run.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$HERE/backup-config.sh"
if [ ! -f "$CONFIG" ]; then
  echo "error: $CONFIG not found. Copy backup-config.sh.example and fill it in." >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$CONFIG"

echo "[swap-to-vps] stopping PM2 services..."
pm2 stop finalsrr-server finalsrr-bot || true
pm2 save || true

mkdir -p "$PROD_PATH/data"
touch "$PROD_PATH/data/.STANDBY"

echo ""
echo "[swap-to-vps] Homelab is now in STANDBY."
echo "  - Nightly backups will pull from: $VPS_URL"
echo "  - Backups stored under: $BACKUP_ROOT"
echo "  - To return to homelab as canonical: ./scripts/swap-from-vps.sh"
```

- [ ] **Step 2: Make executable + commit**

```bash
chmod +x scripts/swap-to-vps.sh
git add scripts/swap-to-vps.sh
git update-index --chmod=+x scripts/swap-to-vps.sh
git commit -m "Add swap-to-vps.sh standby toggle"
```

---

### Task 9: `pull-vps-backup.sh` (cron-driven)

**Files:**
- Create: `scripts/pull-vps-backup.sh`

- [ ] **Step 1: Create the script**

Create `scripts/pull-vps-backup.sh`:

```bash
#!/usr/bin/env bash
# Nightly pull of VPS SQLite snapshot. No-op unless data/.STANDBY exists.
# Safe to leave in crontab year-round.
#
# Flags:
#   --final   In addition to normal pull, create a .FINAL marker in the dest dir
#             so swap-from-vps.sh can identify the snapshot used for swap-back.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$HERE/backup-config.sh"
if [ ! -f "$CONFIG" ]; then
  echo "error: $CONFIG not found." >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$CONFIG"

FINAL=0
for arg in "$@"; do
  case "$arg" in
    --final) FINAL=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

if [ ! -f "$PROD_PATH/data/.STANDBY" ]; then
  # Not in standby — nothing to do. Stay silent so cron mail doesn't spam.
  exit 0
fi

mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT" 2>/dev/null || true

TS="$(date -u +%Y%m%d_%H%M%SZ)"
DEST="$BACKUP_ROOT/$TS"
mkdir -p "$DEST"

LOG_LINE() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >> "$BACKUP_ROOT/pull.log"
}

echo "[pull] $(date -u +%Y-%m-%dT%H:%M:%SZ) fetching from $VPS_URL ..."
if ! curl -sSf -H "X-Backup-Secret: $BACKUP_SECRET" \
        -o "$DEST/snapshot.tar.gz" \
        "$VPS_URL/internal/db-snapshot"; then
  LOG_LINE "FAIL $TS curl failed"
  echo "[pull] curl failed. Leaving $DEST for inspection." >&2
  exit 1
fi

if ! tar xzf "$DEST/snapshot.tar.gz" -C "$DEST"; then
  LOG_LINE "FAIL $TS tar extract failed"
  echo "[pull] tar extract failed. Leaving $DEST for inspection." >&2
  exit 1
fi
rm -f "$DEST/snapshot.tar.gz"

# Verify expected DBs are present and non-empty
MISSING=0
for db in accounts metrics sessions; do
  if [ ! -s "$DEST/${db}.sqlite" ]; then
    echo "[pull] WARN: $DEST/${db}.sqlite missing or empty" >&2
    MISSING=1
  fi
done
if [ "$MISSING" -ne 0 ]; then
  LOG_LINE "FAIL $TS one or more DBs missing/empty"
  exit 1
fi

if [ "$FINAL" -eq 1 ]; then
  touch "$DEST/.FINAL"
fi

# Prune: keep newest $RETENTION dirs
PRUNED=0
# shellcheck disable=SC2012
ls -1t "$BACKUP_ROOT" 2>/dev/null | grep -E '^[0-9]{8}_[0-9]{6}Z$' | tail -n +$((RETENTION + 1)) | while read -r old; do
  rm -rf "$BACKUP_ROOT/$old"
  PRUNED=$((PRUNED + 1))
done

LOG_LINE "OK $TS final=$FINAL"
echo "[pull] OK $DEST (final=$FINAL)"
```

- [ ] **Step 2: Make executable + commit**

```bash
chmod +x scripts/pull-vps-backup.sh
git add scripts/pull-vps-backup.sh
git update-index --chmod=+x scripts/pull-vps-backup.sh
git commit -m "Add pull-vps-backup.sh cron pull script"
```

---

### Task 10: `swap-from-vps.sh`

**Files:**
- Create: `scripts/swap-from-vps.sh`

- [ ] **Step 1: Create the script**

Create `scripts/swap-from-vps.sh`:

```bash
#!/usr/bin/env bash
# Come back from VPS standby. Pulls one final snapshot, atomically swaps the
# SQLite files (old files preserved as *.preswap-<unix-ts>), and starts PM2.
#
# Flags:
#   --dry-run   Print planned mv/cp ops without executing.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$HERE/backup-config.sh"
if [ ! -f "$CONFIG" ]; then
  echo "error: $CONFIG not found." >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$CONFIG"

DRY=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

if [ ! -f "$PROD_PATH/data/.STANDBY" ]; then
  echo "error: not in standby mode (no $PROD_PATH/data/.STANDBY). Refusing to swap." >&2
  exit 1
fi

read -r -p "This will pull a final snapshot from VPS and restore it to homelab. Continue? [y/N] " ans
case "$ans" in
  y|Y|yes|YES) ;;
  *) echo "aborted."; exit 1 ;;
esac

echo "[swap-from-vps] pulling final snapshot..."
if [ "$DRY" -eq 1 ]; then
  echo "  [dry-run] would run: $HERE/pull-vps-backup.sh --final"
else
  "$HERE/pull-vps-backup.sh" --final
fi

# Find newest dir with a .FINAL marker
LATEST_FINAL="$(find "$BACKUP_ROOT" -mindepth 2 -maxdepth 2 -name '.FINAL' -printf '%h\n' 2>/dev/null | sort -r | head -n 1)"
if [ -z "$LATEST_FINAL" ] && [ "$DRY" -eq 0 ]; then
  echo "error: no .FINAL snapshot found under $BACKUP_ROOT" >&2
  exit 1
fi

echo "[swap-from-vps] using snapshot: ${LATEST_FINAL:-<dry-run>}"

echo "[swap-from-vps] stopping PM2 (defensive)..."
if [ "$DRY" -eq 1 ]; then
  echo "  [dry-run] would run: pm2 stop finalsrr-server finalsrr-bot"
else
  pm2 stop finalsrr-server finalsrr-bot || true
fi

TS_UNIX="$(date +%s)"
for db in accounts metrics sessions; do
  TARGET="$PROD_PATH/data/${db}.sqlite"
  SRC="${LATEST_FINAL:-<DRY>}/${db}.sqlite"
  PRESWAP="${TARGET}.preswap-${TS_UNIX}"

  if [ "$DRY" -eq 1 ]; then
    echo "  [dry-run] mv $TARGET -> $PRESWAP (if exists)"
    echo "  [dry-run] rm -f ${TARGET}-shm ${TARGET}-wal"
    echo "  [dry-run] cp $SRC -> $TARGET"
    continue
  fi

  if [ -f "$TARGET" ]; then
    mv "$TARGET" "$PRESWAP"
  fi
  rm -f "${TARGET}-shm" "${TARGET}-wal"
  cp "$SRC" "$TARGET"
done

if [ "$DRY" -eq 0 ]; then
  rm -f "$PROD_PATH/data/.STANDBY"
  pm2 start finalsrr-server finalsrr-bot
  pm2 save
fi

echo ""
echo "[swap-from-vps] Done."
if [ "$DRY" -eq 0 ]; then
  echo "  - Restored from: $LATEST_FINAL"
  echo "  - Old DBs preserved as: $PROD_PATH/data/*.preswap-${TS_UNIX}"
  echo "  - Delete the .preswap files after verifying the homelab is healthy."
fi
```

- [ ] **Step 2: Make executable + commit**

```bash
chmod +x scripts/swap-from-vps.sh
git add scripts/swap-from-vps.sh
git update-index --chmod=+x scripts/swap-from-vps.sh
git commit -m "Add swap-from-vps.sh end-of-failover restore"
```

---

### Task 11: `restore-from-backup.sh` (break-glass)

**Files:**
- Create: `scripts/restore-from-backup.sh`

- [ ] **Step 1: Create the script**

Create `scripts/restore-from-backup.sh`:

```bash
#!/usr/bin/env bash
# Break-glass: restore from a specific timestamped backup under $BACKUP_ROOT.
# Use case: VPS died mid-month and you want to revive homelab from last night's pull.
#
# Usage: ./restore-from-backup.sh <YYYYMMDD_HHMMSSZ>
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$HERE/backup-config.sh"
if [ ! -f "$CONFIG" ]; then
  echo "error: $CONFIG not found." >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$CONFIG"

if [ $# -lt 1 ]; then
  echo "usage: $0 <backup-timestamp>"
  echo ""
  echo "Available backups under $BACKUP_ROOT:"
  ls -1 "$BACKUP_ROOT" 2>/dev/null | grep -E '^[0-9]{8}_[0-9]{6}Z$' || echo "  (none)"
  exit 2
fi

TS="$1"
SRC_DIR="$BACKUP_ROOT/$TS"
if [ ! -d "$SRC_DIR" ]; then
  echo "error: $SRC_DIR not found" >&2
  exit 1
fi

read -r -p "Restore SQLite DBs from $SRC_DIR? This stops PM2 and overwrites data/*.sqlite. [y/N] " ans
case "$ans" in
  y|Y|yes|YES) ;;
  *) echo "aborted."; exit 1 ;;
esac

echo "[restore] stopping PM2..."
pm2 stop finalsrr-server finalsrr-bot || true

TS_UNIX="$(date +%s)"
for db in accounts metrics sessions; do
  TARGET="$PROD_PATH/data/${db}.sqlite"
  SRC="$SRC_DIR/${db}.sqlite"
  if [ ! -f "$SRC" ]; then
    echo "warn: $SRC missing, skipping ${db}" >&2
    continue
  fi
  if [ -f "$TARGET" ]; then
    mv "$TARGET" "${TARGET}.preswap-${TS_UNIX}"
  fi
  rm -f "${TARGET}-shm" "${TARGET}-wal"
  cp "$SRC" "$TARGET"
done

# Restoring intentionally does NOT remove .STANDBY — operator should re-run
# swap-from-vps.sh later when VPS is reachable again, or manually rm .STANDBY
# and start PM2 if homelab is going canonical permanently from here.
echo ""
echo "[restore] Done."
echo "  - Restored from: $SRC_DIR"
echo "  - Old DBs preserved as: $PROD_PATH/data/*.preswap-${TS_UNIX}"
echo "  - .STANDBY marker LEFT IN PLACE — decide next step:"
echo "      a) VPS coming back online: leave standby, swap-from-vps.sh later"
echo "      b) Permanent fail-back to homelab now: rm $PROD_PATH/data/.STANDBY && pm2 start finalsrr-server finalsrr-bot && pm2 save"
```

- [ ] **Step 2: Make executable + commit**

```bash
chmod +x scripts/restore-from-backup.sh
git add scripts/restore-from-backup.sh
git update-index --chmod=+x scripts/restore-from-backup.sh
git commit -m "Add restore-from-backup.sh break-glass script"
```

---

### Task 12: Operator runbook

**Files:**
- Create: `docs/vps-failover.md`

- [ ] **Step 1: Create the runbook**

Create `docs/vps-failover.md`:

```markdown
# VPS failover runbook

This document covers the planned, month-long swap of canonical FinalsRR
hosting from the homelab to a VPS, and back. Design spec:
[../docs/superpowers/specs/2026-05-14-vps-failover-and-backup-design.md](superpowers/specs/2026-05-14-vps-failover-and-backup-design.md).

## One-time setup

1. Generate a shared secret:
   ```bash
   openssl rand -hex 32
   ```
2. On the **VPS**: add to `.env`
   ```
   BACKUP_SECRET=<the secret from step 1>
   ```
   Restart the web process.
3. On the **homelab**:
   ```bash
   cd /home/antiparty/Desktop/FinalsRR
   cp scripts/backup-config.sh.example scripts/backup-config.sh
   # Edit scripts/backup-config.sh and fill in VPS_URL + BACKUP_SECRET
   chmod 600 scripts/backup-config.sh
   ```
4. On the **homelab**: install the cron entry:
   ```bash
   crontab -e
   # Add:
   0 4 * * * /home/antiparty/Desktop/FinalsRR/scripts/pull-vps-backup.sh >> /home/antiparty/backups/finalsrr/pull.log 2>&1
   ```
   The cron is a no-op unless `data/.STANDBY` exists, so it's safe to leave year-round.

## Swap homelab → VPS (start of month)

1. On the **homelab**, snapshot current data:
   ```bash
   cd /home/antiparty/Desktop/FinalsRR
   ./scripts/seed-vps.sh
   ```
   Note the tarball path it prints (e.g. `scripts/seed-output/seed-<ts>.tar.gz`).
2. Copy the tarball to the VPS:
   ```bash
   scp scripts/seed-output/seed-<ts>.tar.gz vps:~/patches-twitch/data/
   ```
3. On the **VPS**:
   ```bash
   cd ~/patches-twitch/data
   tar xzf seed-<ts>.tar.gz
   pm2 restart all
   ```
4. Point DNS for the main domain at the VPS. Wait for propagation.
   Optionally repoint the homelab to a subdomain so you can still SSH/browse it.
5. On the **homelab**:
   ```bash
   ./scripts/swap-to-vps.sh
   ```
   This stops PM2 permanently (`pm2 save`) and creates `data/.STANDBY`.
   The nightly cron will start pulling backups at 04:00 UTC the next morning.

## Verify nightly backups are working

On the homelab, after the first cron run:
```bash
ls -lt ~/backups/finalsrr/
tail ~/backups/finalsrr/pull.log
```
You should see a timestamped dir containing `accounts.sqlite`, `metrics.sqlite`,
`sessions.sqlite`, all non-empty.

Test reading one:
```bash
sqlite3 ~/backups/finalsrr/<ts>/accounts.sqlite ".schema" | head
```

## Swap VPS → homelab (end of month)

1. Point DNS back at the homelab. Wait for propagation.
2. On the **VPS**: `pm2 stop all` (so it can't write to its DB after the swap).
3. On the **homelab**:
   ```bash
   cd /home/antiparty/Desktop/FinalsRR
   ./scripts/swap-from-vps.sh
   ```
   This pulls one final snapshot, stops PM2 (defensive), atomically swaps
   in the fresh SQLite files (old files preserved as `data/*.preswap-<unix>`),
   removes `.STANDBY`, and starts PM2.
4. Verify the homelab is healthy:
   ```bash
   pm2 status
   pm2 logs finalsrr-bot --lines 50
   curl -i http://localhost:3000/
   ```
5. Once confident, delete the safety files:
   ```bash
   rm /home/antiparty/Desktop/FinalsRR/data/*.preswap-*
   ```

## Break glass: VPS dies mid-month

If the VPS becomes unreachable and you can't pull a final snapshot:

```bash
cd /home/antiparty/Desktop/FinalsRR
./scripts/restore-from-backup.sh   # prints available backup timestamps
./scripts/restore-from-backup.sh <pick-the-most-recent>
# Then either:
#   - leave .STANDBY in place and wait for VPS to come back, OR
#   - permanently fail back:
rm data/.STANDBY
pm2 start finalsrr-server finalsrr-bot && pm2 save
```

Repoint DNS back to the homelab as part of the permanent fail-back.

## Troubleshooting

- **`./swap-from-vps.sh` says "not in standby"**: You're already canonical. Nothing to do.
- **`./pull-vps-backup.sh` silently exits**: That's correct — it's a no-op when `data/.STANDBY` is absent. Force a test by `touch data/.STANDBY` then running it (remove the marker after).
- **401 on endpoint**: `BACKUP_SECRET` on VPS doesn't match `scripts/backup-config.sh` on homelab.
- **404 on endpoint**: `BACKUP_SECRET` env is unset on VPS. Add it to `.env` and restart the web process.
- **Tar extract fails on homelab**: Snapshot dir is preserved at `~/backups/finalsrr/<ts>/` for inspection. Check `snapshot.tar.gz` size; if 0, VPS endpoint errored mid-stream.

## Known gaps

These files are NOT included in the SQLite-only sync, per the design:
- `data/users.json` — confirm before swap whether it's authoritative.
- `cache/*.json` — `cacheUpdater` job will repopulate over time.
- `config/blocked.json` — treated as config-as-code.
```

- [ ] **Step 2: Commit**

```bash
git add docs/vps-failover.md
git commit -m "Add VPS failover operator runbook"
```

---

### Task 13: Final verification

- [ ] **Step 1: Run the full test suite**

Run: `bun run test:unit && bun run test:integration`
Expected: all green. The new tests:
- `snapshotDb produces a consistent single-file snapshot`
- `snapshotDb rejects when destination dir does not exist`
- `GET /internal/db-snapshot returns 401 with missing secret`
- `GET /internal/db-snapshot returns 401 with wrong secret`
- `GET /internal/db-snapshot returns 200 + valid gzipped tar with correct secret`
- `GET /internal/db-snapshot returns 404 when BACKUP_SECRET env is empty`

- [ ] **Step 2: Build**

Run: `bun run build`
Expected: tsc completes with no errors.

- [ ] **Step 3: End-to-end manual smoke (local)**

Terminal A:
```powershell
$env:BACKUP_SECRET="local-test-$(Get-Random)"
bun run dev:server
```

Terminal B (record the secret value from Terminal A):
```powershell
$secret = "<paste the secret>"
curl.exe -i -H "X-Backup-Secret: $secret" -o snap.tar.gz http://localhost:3000/internal/db-snapshot
tar tzf snap.tar.gz
```
Expected: HTTP 200 in the curl output; `tar tzf` lists `accounts.sqlite`, `metrics.sqlite`, `sessions.sqlite`.

Cleanup: stop the dev server in Terminal A, `Remove-Item snap.tar.gz`.

- [ ] **Step 4: Commit any final fixes if needed**

If verification revealed issues, fix and recommit. Then push:

```bash
git push origin main
```

---

## Post-implementation deploy notes (NOT part of the implementation — operator runs after merge)

1. SSH to **homelab**: `cd /home/antiparty/Desktop/FinalsRR && ./deploy.sh` (or trigger via the existing deploy-server.mjs hook).
2. Set `BACKUP_SECRET` in the homelab `.env`. Restart so the web process picks it up.
3. Repeat on the **VPS** once it's provisioned and the code is deployed there.
4. Install the cron entry per the runbook (Task 12).
5. Execute the runbook's "Swap homelab → VPS (start of month)" section when ready.
