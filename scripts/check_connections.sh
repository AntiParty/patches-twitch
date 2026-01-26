#!/bin/bash

echo "=== CONNECTION STATISTICS ==="
echo ""

NODE_PID=$(pgrep -f "node.*index.js" | head -1)

if [ -z "$NODE_PID" ]; then
    echo "Error: Node.js process not found!"
    exit 1
fi

echo "Node.js PID: $NODE_PID"
echo ""

echo "--- IRC Connections ---"
IRC_COUNT=$(netstat -an | grep ':6667' | grep ESTABLISHED | wc -l)
echo "Active IRC connections: $IRC_COUNT"
netstat -an | grep ':6667' | grep ESTABLISHED | head -5
echo ""

echo "--- WebSocket Connections ---"
WS_COUNT=$(netstat -an | grep ESTABLISHED | grep -E ':(443|80)' | wc -l)
echo "Active WebSocket connections: $WS_COUNT"
echo ""

echo "--- Open File Descriptors ---"
FD_COUNT=$(ls -1 /proc/$NODE_PID/fd 2>/dev/null | wc -l)
echo "Total open file descriptors: $FD_COUNT"
echo ""
echo "File descriptor breakdown:"
lsof -p $NODE_PID 2>/dev/null | awk '{print $5}' | sort | uniq -c | sort -rn | head -10
echo ""

echo "--- Network Connections by State ---"
lsof -p $NODE_PID -i 2>/dev/null | awk 'NR>1 {print $8}' | sort | uniq -c | sort -rn
echo ""

echo "--- Top 10 Open Files ---"
lsof -p $NODE_PID 2>/dev/null | head -11
