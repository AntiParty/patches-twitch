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
        -D "$DEST/headers.txt" \
        -o "$DEST/snapshot.tar.gz" \
        "$VPS_URL/internal/db-snapshot"; then
  LOG_LINE "FAIL $TS curl failed"
  echo "[pull] curl failed. Leaving $DEST for inspection." >&2
  exit 1
fi

MAGIC="$(head -c 2 "$DEST/snapshot.tar.gz" | od -An -tx1 | tr -d ' \n')"
if [ "$MAGIC" = "1f8b" ]; then
  TAR_ARGS="xzf"
else
  TAR_ARGS="xf"
  echo "[pull] WARN: snapshot was not gzip encoded; trying plain tar extract." >&2
  echo "[pull] Response headers were saved to $DEST/headers.txt" >&2
fi

if ! tar "$TAR_ARGS" "$DEST/snapshot.tar.gz" -C "$DEST"; then
  LOG_LINE "FAIL $TS tar extract failed"
  echo "[pull] First response bytes:" >&2
  head -c 200 "$DEST/snapshot.tar.gz" >&2 || true
  echo >&2
  echo "[pull] Response headers:" >&2
  cat "$DEST/headers.txt" >&2 || true
  echo "[pull] tar extract failed. Leaving $DEST for inspection." >&2
  exit 1
fi
rm -f "$DEST/snapshot.tar.gz" "$DEST/headers.txt"

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
# shellcheck disable=SC2012
ls -1t "$BACKUP_ROOT" 2>/dev/null | grep -E '^[0-9]{8}_[0-9]{6}Z$' | tail -n +$((RETENTION + 1)) | while read -r old; do
  rm -rf "$BACKUP_ROOT/$old"
done

LOG_LINE "OK $TS final=$FINAL"
echo "[pull] OK $DEST (final=$FINAL)"
