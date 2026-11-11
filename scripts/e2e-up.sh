#!/usr/bin/env bash
# Start everything the end-to-end tests talk to, seeded, in the background:
#   test network  PLC :2582, PDS :2583, test account   (test-network/start.mjs)
#   backend       :8080, run from source, its own database (tortok_e2e)
#   tracker       :8000                                 (test-content/tracker.mjs)
#   content       :8090, webseed + seeder for the clips (test-content/seeder.mjs)
# then fill the legacy feed with the five test clips.
#
# Used by CI (.github/workflows/e2e.yml) and locally before `npm run e2e:*`.
# Expects dependencies installed in backend/, test-content/ and test-network/.
# Logs and PIDs go to $E2E_DIR.
# Stop with scripts/e2e-down.sh.
#
# Env: E2E_PG_URL  Postgres server URL without a database
#                  (default postgresql://localhost:5432)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
E2E_DIR="${E2E_DIR:-/tmp/tortok-e2e}"
PG_URL="${E2E_PG_URL:-postgresql://localhost:5432}"
DB_URL="$PG_URL/tortok_e2e"
mkdir -p "$E2E_DIR"

start_svc() {
  local name="$1" workdir="$2"
  shift 2
  ( cd "$workdir" && exec "$@" >"$E2E_DIR/$name.log" 2>&1 ) &
  echo $! >"$E2E_DIR/$name.pid"
  echo "  $name started (pid $!) → $E2E_DIR/$name.log"
}

wait_for() {
  local what="$1" check="$2"
  for _ in $(seq 90); do
    if eval "$check" >/dev/null 2>&1; then echo "  $what ready"; return; fi
    sleep 1
  done
  echo "  $what not ready after 90 s; its log:" >&2
  tail -30 "$E2E_DIR/$what.log" >&2 || true
  exit 1
}

echo "→ Database tortok_e2e (recreated)"
psql "$PG_URL/postgres" -qc "DROP DATABASE IF EXISTS tortok_e2e WITH (FORCE)"
psql "$PG_URL/postgres" -qc "CREATE DATABASE tortok_e2e"

echo "→ Services"
export E2E_NETWORK_FILE="$E2E_DIR/network.json"
rm -f "$E2E_NETWORK_FILE"
start_svc network "$REPO_ROOT/test-network" node start.mjs
start_svc tracker "$REPO_ROOT/test-content" node tracker.mjs
start_svc content "$REPO_ROOT/test-content" node seeder.mjs
# The test stack has no Jetstream, and must not reach Bluesky's (the
# backend's default), so ingest points at a closed local port and retries
# quietly, with no seed accounts (set empty, so a local backend/.env can't
# add any). The feed doesn't read ingested posts until Phase 3 Unit 2.5B.
NODE_ENV=test PORT=8080 DATABASE_URL="$DB_URL" JWT_SECRET=e2e-only \
  JETSTREAM_URL=ws://127.0.0.1:9/subscribe INGEST_SEED_DIDS='' \
  start_svc backend "$REPO_ROOT/backend" node -r ts-node/register/transpile-only src/index.ts

wait_for network "test -f '$E2E_NETWORK_FILE'"
wait_for tracker "curl -sf http://localhost:8000/stats"
# The seeder rewrites test-content/bbb-0?.magnet.txt once each clip is seeded
# (identically, since the torrents are deterministic); its log counts them.
wait_for content "grep -q '\[5/5\]' '$E2E_DIR/content.log' && curl -sf -o /dev/null http://localhost:8090/bbb-01.mp4"
wait_for backend "curl -sf http://localhost:8080/health"

echo "→ Legacy feed: the five test clips, owned by testuser"
( cd "$REPO_ROOT/test-content" && DATABASE_URL="$DB_URL" node seed-db.mjs >"$E2E_DIR/seed.log" 2>&1 )
count=$(curl -sf 'http://localhost:8080/videos/feed?limit=10' | jq '.videos | length')
if [ "$count" != 5 ]; then echo "  feed has $count videos, expected 5" >&2; exit 1; fi
echo "  feed serves 5 videos"
echo "✓ e2e stack up"
