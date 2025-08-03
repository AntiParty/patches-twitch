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

# Install dependencies (you can add --production if you want only prod deps)
npm install

# Build your project if needed (uncomment if applicable)
# npm run build

# Restart your app with pm2 (adjust the app name accordingly)
pm2 restart finalsrr-prod

<<<<<<< HEAD
echo "Deployment complete."
=======
echo "Deployment complete."
>>>>>>> 2ab71d6 (Update .gitignore)
