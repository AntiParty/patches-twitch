#!/bin/bash

# Get the project root directory (parent of scripts directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "=== DATABASE STATISTICS ==="
echo "Project Root: $PROJECT_ROOT"
echo ""

echo "--- Accounts Database ---"
if [ -f "$PROJECT_ROOT/data/accounts.sqlite" ]; then
    sqlite3 "$PROJECT_ROOT/data/accounts.sqlite" << EOF
.timer on
SELECT COUNT(*) as total_channels FROM Channels;
SELECT COUNT(*) as total_custom_responses FROM CustomResponses;
SELECT COUNT(*) as total_stream_sessions FROM StreamSessions;
SELECT COUNT(*) as total_command_usage FROM CommandUsage;
SELECT COUNT(*) as total_rank_goals FROM RankGoals;
EOF
else
    echo "accounts.sqlite not found at $PROJECT_ROOT/data/accounts.sqlite"
fi

echo ""
echo "--- Metrics Database ---"
if [ -f "$PROJECT_ROOT/data/metrics.sqlite" ]; then
    sqlite3 "$PROJECT_ROOT/data/metrics.sqlite" << EOF
.timer on
SELECT COUNT(*) as total_request_metrics FROM RequestMetrics;
SELECT COUNT(*) as total_performance_metrics FROM PerformanceMetrics;
SELECT COUNT(*) as total_analytics_days FROM AnalyticsDays;
SELECT COUNT(*) as total_ign_visits FROM IGNVisits;
SELECT COUNT(*) as total_referrals FROM Referrals;
EOF
else
    echo "metrics.sqlite not found at $PROJECT_ROOT/data/metrics.sqlite"
fi

echo ""
echo "--- Data Age Analysis ---"
if [ -f "$PROJECT_ROOT/data/metrics.sqlite" ]; then
    echo "RequestMetrics:"
    sqlite3 "$PROJECT_ROOT/data/metrics.sqlite" "SELECT MIN(timestamp) as oldest, MAX(timestamp) as newest FROM RequestMetrics;" 2>/dev/null || echo "No data"
fi

if [ -f "$PROJECT_ROOT/data/accounts.sqlite" ]; then
    echo ""
    echo "CommandUsage:"
    sqlite3 "$PROJECT_ROOT/data/accounts.sqlite" "SELECT MIN(timestamp) as oldest, MAX(timestamp) as newest FROM CommandUsage;" 2>/dev/null || echo "No data"
fi

echo ""
echo "--- Database File Sizes ---"
du -h "$PROJECT_ROOT/data"/*.sqlite* 2>/dev/null | sort -h || echo "No database files found"

echo ""
echo "--- WAL Mode Status ---"
if [ -f "$PROJECT_ROOT/data/accounts.sqlite" ]; then
    echo "accounts.sqlite: $(sqlite3 "$PROJECT_ROOT/data/accounts.sqlite" 'PRAGMA journal_mode;')"
fi
if [ -f "$PROJECT_ROOT/data/metrics.sqlite" ]; then
    echo "metrics.sqlite: $(sqlite3 "$PROJECT_ROOT/data/metrics.sqlite" 'PRAGMA journal_mode;')"
fi
if [ -f "$PROJECT_ROOT/data/sessions.sqlite" ]; then
    echo "sessions.sqlite: $(sqlite3 "$PROJECT_ROOT/data/sessions.sqlite" 'PRAGMA journal_mode;')"
fi
