#!/bin/bash

##############################################
# CONFIG
##############################################

PROD_PATH="/home/antiparty/dev/FinalsRS"
BACKUP_ROOT="/home/antiparty/dev"
SERVER_NAME="finalsrr-server"
BOT_NAME="finalsrr-bot"

##############################################
# START
##############################################

echo "----------------------------------------"
echo "Starting Deployment Script"
echo "Timestamp: $(date)"
echo "----------------------------------------"

# Ensure we're inside the production directory
if [ ! -d "$PROD_PATH" ]; then
    echo "❌ ERROR: Production directory not found: $PROD_PATH"
    exit 1
fi

if [[ "$(pwd)" != "$PROD_PATH" ]]; then
    echo "Switching to production directory: $PROD_PATH"
    cd "$PROD_PATH" || exit 1
fi

##############################################
# BACKUP
##############################################

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="${BACKUP_ROOT}/FinalsRS_backup_${TIMESTAMP}"

echo "Creating backup at: $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"

if command -v rsync >/dev/null 2>&1; then
    rsync -av \
        --exclude='.git' \
        --exclude='node_modules' \
        --exclude='dist' \
        --exclude='.env' \
        ./ "$BACKUP_DIR"/
else
    echo "⚠️ rsync not found — using tar fallback"
    tar --exclude='./node_modules' --exclude='./.git' --exclude='./dist' --exclude='./.env' -cf - . \
        | (cd "$BACKUP_DIR" && tar xf -)
fi

echo "Backup complete."

##############################################
# GIT PULL
##############################################

echo "Pulling latest changes from origin/main..."
if git pull origin main; then
    echo "Git pull successful."
else
    echo "⚠️ Git pull failed — continuing anyway."
fi

##############################################
# DEPENDENCIES
##############################################

echo "Installing dependencies..."

if command -v bun >/dev/null 2>&1; then
    bun install
else
    echo "⚠️ Bun not found — using npm"
    npm install
fi

##############################################
# PM2 RESTART
##############################################

echo "Restarting application..."

if command -v pm2 >/dev/null 2>&1; then
    echo "PM2 detected. Restarting services..."

    pm2 restart "$SERVER_NAME" || echo "⚠️ WARNING: Failed to restart $SERVER_NAME"
    pm2 restart "$BOT_NAME"    || echo "⚠️ WARNING: Failed to restart $BOT_NAME"

else
    echo "⚠️ PM2 not found. Cannot restart processes automatically."
fi

##############################################
# DONE
##############################################

echo "----------------------------------------"
echo "Deployment Finished Successfully"
echo "----------------------------------------"
