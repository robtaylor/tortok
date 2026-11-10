#!/usr/bin/env bash
# Stop the services scripts/e2e-up.sh started. The tortok_e2e database is left
# for inspection; e2e-up.sh recreates it on the next run.

set -uo pipefail

E2E_DIR="${E2E_DIR:-/tmp/tortok-e2e}"
for name in backend content tracker network; do
  pidfile="$E2E_DIR/$name.pid"
  [ -f "$pidfile" ] || continue
  pid="$(cat "$pidfile")"
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" && echo "  stopped $name (pid $pid)"
  fi
  rm -f "$pidfile"
done
