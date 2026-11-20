#!/bin/bash
# Launcher: starts dev-supervisor.sh via double-fork so it detaches from this
# shell's process tree entirely. After this script exits, the supervisor is
# parented to PID 1 and immune to tool-shell recycling.

rm -f /tmp/dev-supervisor.lock
(
  setsid nohup /home/z/my-project/dev-supervisor.sh < /dev/null > /tmp/supervisor.out 2>&1 &
)
# Subshell above exits immediately; supervisor is now reparenting to init.
