#!/bin/bash

# Get the project root directory (parent of scripts directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

REPORT="baseline_report_$(date +%Y%m%d_%H%M%S).txt"

echo "=== MEMORY BASELINE REPORT ===" > "$REPORT"
echo "Generated: $(date)" >> "$REPORT"
echo "Project Root: $PROJECT_ROOT" >> "$REPORT"
echo "" >> "$REPORT"

echo "--- System Memory ---" >> "$REPORT"
free -h >> "$REPORT"
echo "" >> "$REPORT"

echo "--- Node.js Process Memory ---" >> "$REPORT"
ps aux | grep node | grep -v grep >> "$REPORT"
echo "" >> "$REPORT"

echo "--- Database Sizes ---" >> "$REPORT"
du -h "$PROJECT_ROOT/data"/*.sqlite* 2>/dev/null >> "$REPORT" || echo "No database files found" >> "$REPORT"
echo "" >> "$REPORT"

echo "--- Cache Sizes ---" >> "$REPORT"
du -sh "$PROJECT_ROOT/cache/" 2>/dev/null >> "$REPORT" || echo "Cache directory not found" >> "$REPORT"
du -h "$PROJECT_ROOT/cache"/*.json 2>/dev/null | sort -h >> "$REPORT"
echo "" >> "$REPORT"

echo "--- Database Row Counts ---" >> "$REPORT"
if [ -f "$PROJECT_ROOT/data/accounts.sqlite" ]; then
    echo "Channels: $(sqlite3 "$PROJECT_ROOT/data/accounts.sqlite" 'SELECT COUNT(*) FROM Channels;')" >> "$REPORT"
    echo "CommandUsage: $(sqlite3 "$PROJECT_ROOT/data/accounts.sqlite" 'SELECT COUNT(*) FROM CommandUsage;')" >> "$REPORT"
else
    echo "accounts.sqlite not found" >> "$REPORT"
fi

if [ -f "$PROJECT_ROOT/data/metrics.sqlite" ]; then
    echo "RequestMetrics: $(sqlite3 "$PROJECT_ROOT/data/metrics.sqlite" 'SELECT COUNT(*) FROM RequestMetrics;')" >> "$REPORT"
    echo "PerformanceMetrics: $(sqlite3 "$PROJECT_ROOT/data/metrics.sqlite" 'SELECT COUNT(*) FROM PerformanceMetrics;')" >> "$REPORT"
else
    echo "metrics.sqlite not found" >> "$REPORT"
fi
echo "" >> "$REPORT"

echo "--- Active Connections ---" >> "$REPORT"
echo "IRC Connections: $(netstat -an | grep ':6667' | grep ESTABLISHED | wc -l)" >> "$REPORT"
NODE_PID=$(pgrep -f "node.*index.js" | head -1)
if [ -n "$NODE_PID" ]; then
    echo "Open File Descriptors: $(ls -1 /proc/$NODE_PID/fd 2>/dev/null | wc -l)" >> "$REPORT"
else
    echo "Node.js process not found" >> "$REPORT"
fi
echo "" >> "$REPORT"

echo "--- Oldest Data in Metrics ---" >> "$REPORT"
if [ -f "$PROJECT_ROOT/data/metrics.sqlite" ]; then
    sqlite3 "$PROJECT_ROOT/data/metrics.sqlite" "SELECT MIN(timestamp) as oldest_request FROM RequestMetrics;" >> "$REPORT" 2>/dev/null || echo "No RequestMetrics data" >> "$REPORT"
fi
if [ -f "$PROJECT_ROOT/data/accounts.sqlite" ]; then
    sqlite3 "$PROJECT_ROOT/data/accounts.sqlite" "SELECT MIN(timestamp) as oldest_command FROM CommandUsage;" >> "$REPORT" 2>/dev/null || echo "No CommandUsage data" >> "$REPORT"
fi

echo ""
echo "Report saved to: $REPORT"
echo ""
cat "$REPORT"
