#!/bin/bash
# Keepalive: ensure Next.js dev server on port 3000 is always running.
# Runs periodically via cron. Restarts the server if it dies or hangs.

LOCKFILE="/tmp/keepalive-running.lock"
LOG="/home/z/my-project/keepalive.log"

# Prevent overlapping runs
if [ -f "$LOCKFILE" ] && kill -0 "$(cat $LOCKFILE 2>/dev/null)" 2>/dev/null; then
  exit 0
fi
echo $$ > "$LOCKFILE"
trap 'rm -f "$LOCKFILE"' EXIT

if curl -s -o /dev/null -m 8 http://localhost:3000; then
  # Server healthy - nothing to do
  exit 0
fi

# Server not responding. Clean up any zombie/hung processes first.
pkill -f "next dev" 2>/dev/null
pkill -f "next-server" 2>/dev/null
sleep 2

# Restart fully detached so it survives shell/session termination
cd /home/z/my-project
setsid nohup bun run dev < /dev/null > /dev/null 2>&1 &
disown

echo "$(date '+%Y-%m-%d %H:%M:%S') - dev server restarted by keepalive" >> "$LOG"
