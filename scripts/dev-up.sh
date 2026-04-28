#!/usr/bin/env bash
# Start backend, tracker, and seeder in the background.
# Logs go to /tmp/tortok-dev/<svc>.log, PIDs to <svc>.pid.
# Idempotent: skips any service whose port is already in use.
# Metro is NOT started here — run `npm start` in tortok/ separately.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="/tmp/tortok-dev"
mkdir -p "$LOG_DIR"

is_listening() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN -t >/dev/null 2>&1
}

start_svc() {
  local name="$1" port="$2" workdir="$3"
  shift 3
  local logfile="$LOG_DIR/$name.log"
  local pidfile="$LOG_DIR/$name.pid"

  if is_listening "$port"; then
    echo "  $name  already running on :$port (skipping)"
    return
  fi

  ( cd "$workdir" && exec "$@" >"$logfile" 2>&1 ) &
  echo $! >"$pidfile"
  echo "  $name  started on :$port (pid $(cat "$pidfile"))  → $logfile"
}

echo "→ Checking postgres on :5432…"
if ! pg_isready -h localhost -p 5432 -q; then
  echo "  postgres NOT reachable on localhost:5432"
  echo "  start it before running this script (brew services start postgresql, or your equivalent)"
  exit 1
fi
echo "  postgres OK"

echo "→ Starting services (logs in $LOG_DIR)…"
start_svc backend 8080 "$REPO_ROOT/backend" npm run dev
start_svc tracker 8000 "$REPO_ROOT/test-content" node tracker.mjs
start_svc seeder  8090 "$REPO_ROOT/test-content" node seeder.mjs

echo
echo "Tail logs with:"
echo "  tail -f $LOG_DIR/backend.log"
echo "  tail -f $LOG_DIR/tracker.log"
echo "  tail -f $LOG_DIR/seeder.log"
echo
echo "Then start Metro in another terminal:"
echo "  cd $REPO_ROOT/tortok && npm start"
echo
echo "Stop everything: $REPO_ROOT/scripts/dev-down.sh"
