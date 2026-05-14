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
