# VPS failover runbook

This document covers the planned, month-long swap of canonical FinalsRR
hosting from the homelab to a VPS, and back. Design spec:
[superpowers/specs/2026-05-14-vps-failover-and-backup-design.md](superpowers/specs/2026-05-14-vps-failover-and-backup-design.md).

## One-time setup

1. Generate a shared secret:
   ```bash
   openssl rand -hex 32
   ```
2. On the **VPS**: add to `.env`
   ```
   BACKUP_SECRET=<the secret from step 1>
   ```
   Restart the web process so the env is picked up.
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
4. Point DNS for `finalsrs.com` at the VPS. Set `home.finalsrs.com` to the
   homelab so you can still SSH/browse it. Wait for propagation.
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

1. Point DNS for `finalsrs.com` back at the homelab. Wait for propagation.
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
./scripts/restore-from-backup.sh                  # prints available backup timestamps
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
- **`bad interpreter` error on a script**: Line endings got converted to CRLF. Run `dos2unix scripts/*.sh` or re-clone the repo on the homelab.

## Known gaps

These files are NOT included in the SQLite-only sync, per the design:
- `data/users.json` — confirm before swap whether it's authoritative.
- `cache/*.json` — `cacheUpdater` job will repopulate over time after swap-back.
- `config/blocked.json` — treated as config-as-code; runtime edits on VPS will be lost.
