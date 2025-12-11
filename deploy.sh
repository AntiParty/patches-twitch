#!/bin/bash
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/bin:/sbin:/home/antiparty/.bun/bin"
export PM2_HOME="/home/antiparty/.pm2"

##############################################
# AUTO-DETECT BINARIES
##############################################

GIT=$(command -v git)
NPM=$(command -v npm)
PM2=$(command -v pm2)
BUN=$(command -v bun)

echo "Detected git: $GIT"
echo "Detected npm: $NPM"
echo "Detected pm2: $PM2"
echo "Detected bun: $BUN"

##############################################
# CONFIG
##############################################

PROD_PATH="/home/antiparty/Desktop/FinalsRR"
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

cd "$PROD_PATH" || { echo "? PROD PATH missing"; exit 1; }

##############################################
# BACKUP
##############################################

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="${BACKUP_ROOT}/FinalsRS_backup_${TIMESTAMP}"

echo "Creating backup at: $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"

if command -v rsync >/dev/null 2>&1; then
    rsync -av --exclude='.git' --exclude='node_modules' --exclude='dist' --exclude='.env' ./ "$BACKUP_DIR"/
else
    echo "?? rsync missing, using tar fallback"
    tar --exclude='./node_modules' --exclude='./.git' --exclude='./dist' --exclude='./.env' \
        -cf - . | (cd "$BACKUP_DIR" && tar xf -)
fi

echo "Backup complete."

##############################################
# GIT PULL
##############################################

echo "Pulling latest changes..."
if [ -x "$GIT" ]; then
    "$GIT" pull origin main || echo "?? git pull failed"
else
    echo "? git NOT FOUND"
fi

##############################################
# DEPENDENCIES
##############################################

echo "Installing dependencies..."

if [ -x "$BUN" ]; then
    chmod +x "$BUN" 2>/dev/null
    "$BUN" install || echo "?? bun install failed"
else
    echo "?? bun missing, using npm"
    "$NPM" install || echo "?? npm install failed"
fi

##############################################
# PM2 RESTART
##############################################

echo "Restarting services..."

if [ -x "$PM2" ]; then
    "$PM2" restart "$SERVER_NAME" || echo "?? failed to restart $SERVER_NAME"
    "$PM2" restart "$BOT_NAME" || echo "?? failed to restart $BOT_NAME"
else
    echo "? PM2 NOT FOUND"
fi

##############################################
# DONE
##############################################

echo "----------------------------------------"
echo "Deployment Finished"
echo "----------------------------------------"
