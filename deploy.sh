#!/bin/bash

# Define Production Path
PROD_PATH="/home/antiparty/dev/FinalsRS"

echo "----------------------------------------"
echo "Starting Deployment Script"
echo "Timestamp: $(date)"
echo "----------------------------------------"

# Check if we are in the production environment
# If the PROD_PATH exists and we are NOT currently in it (or we are just generic), ensure correct dir.
# But for testing on Windows, PROD_PATH won't exist, so we stay in current dir.
if [ -d "$PROD_PATH" ]; then
    echo "Production path detected: $PROD_PATH"
    # If we are not already inside that directory (simple string check, might need realpath in strict cases)
    if [[ "$(pwd)" != *"$PROD_PATH"* ]]; then
        echo "Switching to production directory..."
        cd "$PROD_PATH" || exit 1
    fi
    BACKUP_ROOT="/home/antiparty/dev"
else
    echo "Non-standard environment detected (Windows/Dev)."
    echo "Running in: $(pwd)"
    # Backup to parent directory in dev
    BACKUP_ROOT="../"
fi

# Define Backup Directory
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="${BACKUP_ROOT}/FinalsRS_backup_${TIMESTAMP}"

# 1. Create Backup
echo "Creating backup at: $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"

if command -v rsync &> /dev/null; then
    # MacOS/Linux with rsync
    rsync -av --exclude='.git' --exclude='node_modules' --exclude='dist' --exclude='.env' ./ "$BACKUP_DIR"/
else
    echo "rsync not found. Using tar for backup (Windows/GitBash compatible)..."
    # Use tar to handle exclusions cleanly without copying massive node_modules
    tar --exclude='./node_modules' --exclude='./.git' --exclude='./dist' --exclude='./.env' -cf - . | (cd "$BACKUP_DIR" && tar xf -)
fi

echo "Backup complete."

# 2. Pull Code
echo "Pulling changes from origin/main..."
if git pull origin main; then
    echo "Git pull successful."
else
    echo "Git pull failed. You might have local changes or no internet."
    # We don't exit here strictly, user might just want to restart/rebuild even if pull fails in dev
fi

# 3. Install Dependencies
echo "Installing dependencies..."
if command -v bun &> /dev/null; then
    bun install
else
    echo "Bun not found, using npm..."
    npm install
fi

# 4. Restart Services
echo "Restarting application..."

if command -v pm2 &> /dev/null; then
    echo "PM2 detected. Restarting services..."
    pm2 restart FinalsRS-server || echo "Warning: Failed to restart FinalsRS-server (Is it running?)"
    pm2 restart FinalsRS-bot || echo "Warning: Failed to restart FinalsRS-bot (Is it running?)"
else
    echo "PM2 not found. Skipping automatic process restart."
    echo "If running locally with a watcher, it should update automatically."
fi

echo "----------------------------------------"
echo "Deployment Finished Successfully"
echo "----------------------------------------"