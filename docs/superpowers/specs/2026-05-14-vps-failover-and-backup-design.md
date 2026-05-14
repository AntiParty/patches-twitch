# VPS failover and nightly backup — design spec

**Date:** 2026-05-14
**Status:** Design (pre-implementation)
**Owner:** Antiparty

## Goal

Enable a planned, month-long swap of the canonical patches-twitch (FinalsRR) deployment from the homelab to a VPS, and back, without losing data. While the VPS is canonical, the homelab pulls a nightly backup of the VPS's SQLite databases. When swapping back, the homelab takes a final pull and restores those files atomically.

## Non-goals

- DNS automation (operator points DNS by hand)
- Backup of `data/users.json`, `cache/*.json`, or `config/blocked.json` (per scope decision: SQLite only — see "Known gaps")
- Continuous replication / sub-day RPO
- Automatic failover (HA). This is a planned, operator-driven swap.

## Operational model

Two boxes, asymmetric roles for the month:

- **Homelab (passive):** `pm2 stop`'d for both processes. A marker file `data/.STANDBY` is present. Cron runs `pull-vps-backup.sh` nightly. Cron is a no-op if `.STANDBY` is absent — so the entry can live in crontab permanently.
- **VPS (canonical):** Runs the existing server + bot under PM2. Web process exposes a new internal endpoint, `GET /internal/db-snapshot`, that streams a fresh consistent snapshot of all SQLite DBs.

## Architecture

### Snapshot endpoint (VPS)

New router file: `src/routes/admin/internal-backup.ts`, mounted at `/internal` in `src/index.ts`.

- **Route:** `GET /internal/db-snapshot`
- **Auth:** Constant-time compare of `X-Backup-Secret` header against `process.env.BACKUP_SECRET`. 401 on mismatch or missing secret. Treat missing/empty `BACKUP_SECRET` env as "feature disabled" → 404, so the endpoint can't be brute-forced when not configured.
- **Rate limit:** New `express-rate-limit` instance scoped to this route only: **10 requests per hour per IP**. (Cron only needs 1/day; this leaves headroom for retries.)
- **Snapshot mechanism:** For each DB in `data/{accounts,metrics,sessions}.sqlite`:
  - Open a fresh `sqlite3.Database` connection (read-write — `VACUUM INTO` requires the source connection be writable, but the operation itself only reads the source and writes the destination).
  - Run `VACUUM INTO '<tmpdir>/<name>.sqlite'`. Online-safe (briefly takes a shared lock on the source; does not block other readers and only briefly blocks writers), produces a single clean file (no `-wal` / `-shm` sidecars), and works against a DB the bot/server is actively using. Requires SQLite ≥ 3.27 (2019); the `sqlite3` npm package bundles a recent enough version.
  - Close the connection.
- **Response:** Stream a tar.gz of the tmpdir as `application/x-tar` with `Content-Encoding: gzip` and `Content-Disposition: attachment; filename="snapshot-<iso>.tar.gz"`. Use `tar` (npm `tar` package or `child_process` to `tar -czf - .`) piped to `res`. No in-memory buffering.
- **Cleanup:** `try/finally` removes the tmpdir on both success and failure.
- **Logging:** `logger.info('[backup] snapshot served', { ip, size, durationMs })` on success. `logger.warn('[backup] unauthorized', { ip })` on auth failure. `logger.error('[backup] snapshot failed', err)` on error.

### Scripts (homelab)

All scripts live under `scripts/` in the repo (not the existing root-level `scripts/` directory, which has Twitch OAuth helpers — these go alongside). Each is a POSIX bash script with `set -euo pipefail`.

Shared config sourced from `scripts/backup-config.sh` (gitignored):

```bash
VPS_URL="https://your-vps-domain.example"   # set by operator
BACKUP_SECRET="..."                          # matches VPS env
BACKUP_ROOT="$HOME/backups/finalsrr"
PROD_PATH="/home/antiparty/Desktop/FinalsRR"
RETENTION=14
```

A `scripts/backup-config.sh.example` checked into git as the template.

#### `scripts/seed-vps.sh` (homelab, one-shot)

Used once at the start, before flipping. Produces a tarball the operator scp's to the VPS by hand.

1. Confirm with operator (`read -p "Stop PM2 and snapshot SQLite? [y/N]"`).
2. `pm2 stop finalsrr-server finalsrr-bot`.
3. Snapshot each `data/*.sqlite` via a small Node one-liner using the `sqlite3` package's `VACUUM INTO`, into `scripts/seed-output/<ts>/`.
4. `tar czf scripts/seed-output/seed-<ts>.tar.gz -C scripts/seed-output/<ts> .`.
5. Print exact next-step commands for the operator (scp + tar extract on VPS + `pm2 restart all`).
6. Do **not** start PM2 back up — operator does that explicitly after seeding the VPS and pointing DNS.

#### `scripts/swap-to-vps.sh` (homelab)

The "go to standby" flip.

1. `pm2 stop finalsrr-server finalsrr-bot`.
2. `pm2 save` (so the apps don't restart on reboot).
3. `touch "$PROD_PATH/data/.STANDBY"`.
4. Print: "Homelab in standby. Nightly backups will pull from $VPS_URL. To return: ./scripts/swap-from-vps.sh".

#### `scripts/pull-vps-backup.sh` (homelab, run by cron)

Idempotent. Safe to leave in crontab year-round.

1. `[ -f "$PROD_PATH/data/.STANDBY" ] || exit 0` — no-op if not in standby.
2. `mkdir -p "$BACKUP_ROOT"`.
3. `TS=$(date -u +%Y%m%d_%H%M%SZ)`; `DEST="$BACKUP_ROOT/$TS"`; `mkdir -p "$DEST"`.
4. `curl -sSf -H "X-Backup-Secret: $BACKUP_SECRET" -o "$DEST/snapshot.tar.gz" "$VPS_URL/internal/db-snapshot"`.
5. `tar xzf "$DEST/snapshot.tar.gz" -C "$DEST"` and `rm "$DEST/snapshot.tar.gz"`.
6. Verify each expected DB file is present and non-empty; if not, log error and leave dir for inspection.
7. Prune: keep newest `$RETENTION` timestamped subdirs of `$BACKUP_ROOT`, delete the rest.
8. Append outcome line to `$BACKUP_ROOT/pull.log`.
9. On any curl/tar failure: log and exit non-zero (cron will email if configured), but **do not** remove the failed dir — the partial state is evidence.

Accepts `--final` flag: identical behavior but also produces a sentinel `$BACKUP_ROOT/$TS/.FINAL` for `swap-from-vps.sh` to pick up.

#### `scripts/swap-from-vps.sh` (homelab)

The "come back from standby" flip. Refuses to run if `.STANDBY` is absent.

1. Confirm with operator.
2. `./pull-vps-backup.sh --final`. Abort on failure.
3. Identify the just-pulled directory (most recent under `$BACKUP_ROOT` with a `.FINAL` marker).
4. `pm2 stop finalsrr-server finalsrr-bot` (in case they got started somehow).
5. `TS=$(date +%s)`; for each `db` in `accounts metrics sessions`:
   - If `data/${db}.sqlite` exists: `mv "data/${db}.sqlite" "data/${db}.sqlite.preswap-${TS}"`.
   - `rm -f "data/${db}.sqlite-shm" "data/${db}.sqlite-wal"`.
   - `cp "$LATEST_FINAL/${db}.sqlite" "data/${db}.sqlite"`.
6. `rm "$PROD_PATH/data/.STANDBY"`.
7. `pm2 start finalsrr-server finalsrr-bot && pm2 save`.
8. Print: "Restored from snapshot taken $SNAPSHOT_TS. Old DBs preserved as data/*.preswap-${TS} — delete after verifying."

#### `scripts/restore-from-backup.sh` (homelab, break-glass)

Manual rollback to any timestamped snapshot under `$BACKUP_ROOT`. Takes the timestamp as an argument. Same steps 4–8 as `swap-from-vps.sh`, but reading from `$BACKUP_ROOT/<ts>/` instead of the most recent `.FINAL`. Use case: VPS dies mid-month and you need to revive the homelab from last night's backup.

### Cron entry (homelab)

Documented in the spec; operator installs by hand via `crontab -e`:

```cron
0 4 * * * /home/antiparty/Desktop/FinalsRR/scripts/pull-vps-backup.sh >> /home/antiparty/backups/finalsrr/pull.log 2>&1
```

### Env vars

| Var | Where | Purpose |
|---|---|---|
| `BACKUP_SECRET` | VPS `.env` and homelab `scripts/backup-config.sh` | Shared secret for endpoint auth. Must match on both sides. |
| `VPS_URL` | homelab `scripts/backup-config.sh` | e.g. `https://patches.example.com`. |

Generate with `openssl rand -hex 32` and store in a password manager.

## Data flow

```
Initial seed (manual, one-time):
  homelab pm2 stop
  homelab seed-vps.sh → snapshot tarball
  operator scps tarball → VPS:~/patches-twitch/data/
  operator extracts on VPS
  operator points DNS at VPS
  operator pm2 starts on VPS
  homelab swap-to-vps.sh

During the month:
  cron @ 04:00 UTC: homelab pull-vps-backup.sh
    → GET VPS/internal/db-snapshot (X-Backup-Secret: ...)
    → VPS: VACUUM INTO each DB → tar.gz → stream
    → homelab: save to ~/backups/finalsrr/<ts>/, prune to 14

Coming back:
  operator points DNS back at homelab
  operator stops VPS pm2
  homelab swap-from-vps.sh
    → pull-vps-backup.sh --final
    → pm2 stop
    → atomically swap in fresh SQLite files (old preserved as .preswap-*)
    → rm .STANDBY
    → pm2 start
```

## Security

- `BACKUP_SECRET` is a random 32-byte hex string. Treated as a credential.
- Endpoint compares secrets with `crypto.timingSafeEqual` to avoid timing oracles.
- Endpoint returns **404** (not 401) when `BACKUP_SECRET` env is unset/empty — minimizes signal that the route exists.
- Rate-limited to ~10 req/hour per IP on this route.
- Endpoint relies on the existing public web server's TLS termination (assumed nginx or similar in front). Spec assumes HTTPS; HTTP would leak the secret in the header.
- VPS `pm2 logs` will show backup events with IP and size — these are intentionally logged for audit.
- Snapshots on disk on the homelab contain hashed passwords (bcrypt), session data, and bot OAuth refresh tokens. The `~/backups/finalsrr/` directory should be `chmod 700`.

## Failure handling

| Failure | Behavior |
|---|---|
| VPS unreachable at backup time | curl fails, cron logs error, no partial files committed. Next night retries. |
| VACUUM INTO fails on VPS | Endpoint returns 500 with logged reason. Homelab pull fails, logs, retries next night. |
| Disk full on homelab | curl write fails. Operator must clear `~/backups/finalsrr/` (retention should normally prevent this). |
| Snapshot served but tar corrupt | `tar xzf` fails on homelab. Dir preserved for inspection; not pruned. |
| `swap-from-vps.sh` interrupted between mv and cp | `.preswap-*` files still exist; operator runs script again or restores by hand. PM2 is already stopped, so DBs are quiescent. |
| Operator runs `swap-from-vps.sh` without `.STANDBY` | Script refuses with error. |
| Operator runs `swap-to-vps.sh` while already in standby | `pm2 stop` is idempotent; `touch` re-touches; safe. |

## Known gaps (out of scope, documented for revisit)

- **`data/users.json`** — not synced. If this file holds canonical user data not derivable from `accounts.sqlite`, a month of changes to it will be lost on swap-back. Operator should confirm whether it's authoritative before flipping.
- **`cache/*.json`** — not synced. `cacheUpdater` job will repopulate over time after swap-back; some short-term data (recent peak ranks, RS history) may be stale until the next refresh cycle.
- **`config/blocked.json`** — not synced. Treated as config-as-code; if it's modified at runtime on the VPS, those edits will be lost. Verify it's not runtime-mutable before flipping.
- **Sessions DB** — syncing `sessions.sqlite` means sessions created on the VPS will work on the homelab after swap-back. Acceptable.

## Testing

- **`pull-vps-backup.sh` against a local VPS stand-in:** Run the web server locally with `BACKUP_SECRET=test` set, hit the endpoint with curl, verify the tar extracts to non-empty DB files openable by `sqlite3 .schema`.
- **`swap-from-vps.sh` dry-run mode:** Add a `--dry-run` flag that prints planned `mv`/`cp` ops without executing.
- **Endpoint unit test:** New file `src/tests/integration/internal-backup.test.ts`. Spins up the Express app, hits the endpoint with bad/missing/correct secret, asserts 401/404/200 respectively, and that 200 response is a valid gzipped tar containing the expected file names.
- **Endpoint with empty `BACKUP_SECRET`:** Asserts 404 (feature disabled path).

## Files touched

| Path | Change |
|---|---|
| `src/routes/admin/internal-backup.ts` | NEW — router with `/db-snapshot` route |
| `src/index.ts` | mount the new router at `/internal` |
| `src/tests/integration/internal-backup.test.ts` | NEW — endpoint tests |
| `scripts/seed-vps.sh` | NEW |
| `scripts/swap-to-vps.sh` | NEW |
| `scripts/swap-from-vps.sh` | NEW |
| `scripts/pull-vps-backup.sh` | NEW |
| `scripts/restore-from-backup.sh` | NEW |
| `scripts/backup-config.sh.example` | NEW (template; `backup-config.sh` is gitignored) |
| `scripts/_snapshot.mjs` | NEW — small Node helper that runs `VACUUM INTO` against each DB (used by `seed-vps.sh` and the endpoint) |
| `.gitignore` | add `scripts/backup-config.sh`, `scripts/seed-output/` |
| `docs/DEVELOPER.md` or new `docs/vps-failover.md` | NEW — operator runbook |
