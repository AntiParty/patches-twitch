#!/bin/bash

if [ $# -ne 2 ]; then
    echo "Usage: $0 <baseline_report.txt> <after_report.txt>"
    exit 1
fi

BEFORE=$1
AFTER=$2

echo "=== MEMORY OPTIMIZATION COMPARISON ==="
echo ""

# Extract RSS values
BEFORE_RSS=$(grep "node.*index.js" "$BEFORE" | awk '{print $6}')
AFTER_RSS=$(grep "node.*index.js" "$AFTER" | awk '{print $6}')

echo "RSS Memory:"
echo "  Before: $(echo "scale=2; $BEFORE_RSS/1024" | bc) MB"
echo "  After:  $(echo "scale=2; $AFTER_RSS/1024" | bc) MB"
echo "  Savings: $(echo "scale=2; ($BEFORE_RSS-$AFTER_RSS)/1024" | bc) MB ($(echo "scale=1; ($BEFORE_RSS-$AFTER_RSS)*100/$BEFORE_RSS" | bc)%)"
echo ""

# Extract database sizes
echo "Database Sizes:"
BEFORE_DB=$(grep "metrics.sqlite" "$BEFORE" | grep -v wal | awk '{print $1}')
AFTER_DB=$(grep "metrics.sqlite" "$AFTER" | grep -v wal | awk '{print $1}')
echo "  metrics.sqlite: $BEFORE_DB → $AFTER_DB"
echo ""

# Extract row counts
echo "Row Counts:"
BEFORE_REQ=$(grep "RequestMetrics:" "$BEFORE" | awk '{print $2}')
AFTER_REQ=$(grep "RequestMetrics:" "$AFTER" | awk '{print $2}')
echo "  RequestMetrics: $BEFORE_REQ → $AFTER_REQ"

BEFORE_CMD=$(grep "CommandUsage:" "$BEFORE" | awk '{print $2}')
AFTER_CMD=$(grep "CommandUsage:" "$AFTER" | awk '{print $2}')
echo "  CommandUsage: $BEFORE_CMD → $AFTER_CMD"
echo ""

# Extract connection counts
echo "Connections:"
BEFORE_IRC=$(grep "IRC Connections:" "$BEFORE" | awk '{print $3}')
AFTER_IRC=$(grep "IRC Connections:" "$AFTER" | awk '{print $3}')
echo "  IRC Connections: $BEFORE_IRC → $AFTER_IRC"

BEFORE_FD=$(grep "Open File Descriptors:" "$BEFORE" | awk '{print $4}')
AFTER_FD=$(grep "Open File Descriptors:" "$AFTER" | awk '{print $4}')
echo "  Open File Descriptors: $BEFORE_FD → $AFTER_FD"
