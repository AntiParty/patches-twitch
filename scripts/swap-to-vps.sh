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
