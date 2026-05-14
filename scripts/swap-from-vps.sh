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
