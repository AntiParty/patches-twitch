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

echo ""
echo "[restore] Done."
echo "  - Restored from: $SRC_DIR"
echo "  - Old DBs preserved as: $PROD_PATH/data/*.preswap-${TS_UNIX}"
echo "  - .STANDBY marker LEFT IN PLACE — decide next step:"
echo "      a) VPS coming back online: leave standby, swap-from-vps.sh later"
echo "      b) Permanent fail-back to homelab now: rm $PROD_PATH/data/.STANDBY && pm2 start finalsrr-server finalsrr-bot && pm2 save"
