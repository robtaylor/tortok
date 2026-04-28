#!/usr/bin/env bash
# Stop services started by dev-up.sh by reading pidfiles in /tmp/tortok-dev.

set -euo pipefail

LOG_DIR="/tmp/tortok-dev"

if [[ ! -d "$LOG_DIR" ]]; then
  echo "No $LOG_DIR — nothing to stop."
  exit 0
fi

stop_svc() {
  local name="$1"
  local pidfile="$LOG_DIR/$name.pid"

  if [[ ! -f "$pidfile" ]]; then
    echo "  $name  no pidfile (skipping)"
    return
  fi

  local pid
  pid=$(cat "$pidfile")
  if kill -0 "$pid" 2>/dev/null; then
    # Kill the whole process group so child processes (e.g. ts-node-dev's
    # respawned worker) go down with the parent.
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    echo "  $name  stopped (pid $pid)"
  else
    echo "  $name  not running (stale pidfile)"
  fi
  rm -f "$pidfile"
}

echo "→ Stopping services…"
stop_svc backend
stop_svc tracker
stop_svc seeder
echo "Done."
