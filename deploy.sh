#!/bin/bash

# Change to your project directory
cd /home/antiparty/dev/finalsrr || exit 1

# Check for local uncommitted changes
if [[ -n $(git status --porcelain) ]]; then
  echo "Warning: local changes detected, backing up before deploy..."

  BACKUP_DIR="/home/antiparty/dev/finalsrr_backup_$(date +%Y%m%d_%H%M%S)"
  mkdir -p "$BACKUP_DIR"

  # Backup everything except .git and node_modules
  rsync -av --exclude='.git' --exclude='node_modules' ./ "$BACKUP_DIR"/
fi

# Pull latest changes from origin/main
git pull origin main

# Install dependencies (using Bun if preferred)
bun install

# Build project (TypeScript -> dist)
#bun run build

# Restart both PM2 apps (make sure these names match your ecosystem config)
pm2 restart finalsrr-server
pm2 restart finalsrr-bot

echo "Deployment complete."