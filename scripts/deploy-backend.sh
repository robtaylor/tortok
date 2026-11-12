#!/usr/bin/env bash
# Deploy the backend (tortok-api) to Fly from a clean checkout of main, then
# smoke-check it.
#
#   npm run deploy:backend
#
# 1. Refuses unless the working tree is clean and HEAD is origin/main, so the
#    SHA the image reports is exactly what's deployed.
# 2. `fly deploy` with GIT_SHA and BUILD_TIME build args (/health reports
#    them). fly.toml's blue-green strategy only moves traffic once the new
#    machine's /health passes.
# 3. scripts/smoke.mjs against production, expecting that SHA.
#
# Rollback: `fly releases -a tortok-api --image` lists previous images; then
# `fly deploy -a tortok-api --image <image>` from backend/.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP=tortok-api
BASE_URL=https://tortok-api.fly.dev

cd "$REPO_ROOT"
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "deploy-backend: uncommitted changes; commit or stash them first" >&2
  exit 1
fi
# Untracked files in what the Dockerfile copies would ship in an image whose
# SHA doesn't contain them.
untracked="$(git status --porcelain --untracked-files=all -- backend/src)"
if [[ -n "$untracked" ]]; then
  echo "deploy-backend: untracked files would be copied into the image:" >&2
  echo "$untracked" >&2
  exit 1
fi
git fetch -q origin main
sha="$(git rev-parse HEAD)"
if [[ "$sha" != "$(git rev-parse origin/main)" ]]; then
  echo "deploy-backend: HEAD ($sha) is not origin/main; deploy main only" >&2
  exit 1
fi

(cd backend && fly deploy -a "$APP" \
  --build-arg GIT_SHA="$sha" \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)")

node scripts/smoke.mjs "$BASE_URL" --expect-sha "$sha"
