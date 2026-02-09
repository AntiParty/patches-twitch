#!/bin/bash

LOG_FILE="memory_baseline_$(date +%Y%m%d_%H%M%S).log"
INTERVAL=60  # Check every 60 seconds
DURATION=3600  # Run for 1 hour (3600 seconds)

echo "Starting memory monitoring for $((DURATION/60)) minutes..."
echo "Logging to: $LOG_FILE"
echo "Timestamp,RSS_MB,VSZ_MB,CPU%,Threads,OpenFiles" > "$LOG_FILE"

END_TIME=$(($(date +%s) + DURATION))

while [ $(date +%s) -lt $END_TIME ]; do
    TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
    
    # Get Node.js process stats
    NODE_PID=$(pgrep -f "node.*index.js" | head -1)
    
    if [ -n "$NODE_PID" ]; then
        # Get memory usage (RSS and VSZ in MB)
        MEM_INFO=$(ps -p $NODE_PID -o rss=,vsz=,pcpu=,nlwp= | awk '{printf "%.2f,%.2f,%.2f,%d", $1/1024, $2/1024, $3, $4}')
        
        # Count open file descriptors
        OPEN_FILES=$(ls -1 /proc/$NODE_PID/fd 2>/dev/null | wc -l)
        
        echo "$TIMESTAMP,$MEM_INFO,$OPEN_FILES" >> "$LOG_FILE"
        echo "[$TIMESTAMP] RSS: $(echo $MEM_INFO | cut -d',' -f1) MB"
    else
        echo "[$TIMESTAMP] Node.js process not found!"
    fi
    
    sleep $INTERVAL
done

echo "Monitoring complete. Results saved to: $LOG_FILE"

# Generate summary
echo -e "\n=== SUMMARY ===" >> "$LOG_FILE"
echo "Average RSS: $(awk -F',' 'NR>1 {sum+=$2; count++} END {printf "%.2f MB\n", sum/count}' "$LOG_FILE")" >> "$LOG_FILE"
echo "Peak RSS: $(awk -F',' 'NR>1 {if($2>max) max=$2} END {printf "%.2f MB\n", max}' "$LOG_FILE")" >> "$LOG_FILE"
echo "Average CPU: $(awk -F',' 'NR>1 {sum+=$4; count++} END {printf "%.2f%%\n", sum/count}' "$LOG_FILE")" >> "$LOG_FILE"

# Display summary
echo ""
echo "=== SUMMARY ==="
tail -4 "$LOG_FILE"
