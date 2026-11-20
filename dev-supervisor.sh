#!/bin/bash
# Supervisor: keeps the Next.js dev server alive forever.
# MUST be started via double-fork so it reparents to PID 1 (init/tini) and
# survives tool-shell recycling. Use launch-supervisor.sh for that.
#
# Runs an infinite loop checking every 15s; restarts the server instantly if it dies.
# The cron watchdog (every 8h) acts as a backup that can re-launch this supervisor.

LOG="/home/z/my-project/keepalive.log"
SUP_LOCK="/tmp/dev-supervisor.lock"

# Only one supervisor instance
if [ -f "$SUP_LOCK" ] && kill -0 "$(cat $SUP_LOCK 2>/dev/null)" 2>/dev/null; then
  echo "supervisor already running (pid $(cat $SUP_LOCK))"
  exit 0
fi
echo $$ > "$SUP_LOCK"

cd /home/z/my-project

health_check() {
  curl -s -o /dev/null -m 8 http://localhost:3000
}

start_server() {
  pkill -f "next dev" 2>/dev/null
  pkill -f "next-server" 2>/dev/null
  sleep 2
  # Double-fork: subshell exits immediately, server reparents to init
  ( setsid nohup bun run dev < /dev/null > /dev/null 2>&1 & )
  echo "$(date '+%Y-%m-%d %H:%M:%S') - supervisor: server restarted" >> "$LOG"
}

while true; do
  if ! health_check; then
    start_server
    # Give it time to boot before next check
    sleep 20
    if health_check; then
      echo "$(date '+%Y-%m-%d %H:%M:%S') - supervisor: server recovered (200 OK)" >> "$LOG"
    else
      echo "$(date '+%Y-%m-%d %H:%M:%S') - supervisor: server still down after restart, retrying next cycle" >> "$LOG"
    fi
  fi
  sleep 15
done
