#!/usr/bin/env bash
# Deploy web/public/ to Cloudflare Pages as the `tortok-web` project.
#
# What this does:
#   1. Validates required env vars (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID).
#   2. Creates the Pages project `tortok-web` if it doesn't already exist.
#   3. Prints a one-time manual step URL if the custom domain (tortok.app)
#      has not been bound — Wrangler 4.x has no `pages domain` subcommand
#      so that step cannot be automated.
#   4. Deploys web/public/ to the production branch.
#
# Idempotent: safe to run multiple times. Project creation is skipped if
# the project already exists. Deploy always pushes the latest assets.
#
# Prerequisites:
#   - CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID set in .env (or env)
#   - wrangler installed (it's a devDependency: `npm install`)
#
# Run with:
#   npm run deploy:web
# or directly:
#   bash scripts/deploy-web.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── Load .env if present ───────────────────────────────────────────────────────
ENV_FILE="$REPO_ROOT/.env"
if [[ -f "$ENV_FILE" ]]; then
  # Export only assignments; skip blank lines and comments.
  set -o allexport
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +o allexport
fi

# ── Validate required env vars ────────────────────────────────────────────────
missing=()
[[ -z "${CLOUDFLARE_API_TOKEN:-}" ]] && missing+=("CLOUDFLARE_API_TOKEN")
[[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]] && missing+=("CLOUDFLARE_ACCOUNT_ID")

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "deploy-web: missing required env var(s): ${missing[*]}" >&2
  echo "" >&2
  echo "  Set them in .env (copy from .env.example) or export them." >&2
  echo "" >&2
  echo "  Get a Cloudflare API token at:" >&2
  echo "    https://dash.cloudflare.com/profile/api-tokens" >&2
  echo "  Required permissions:" >&2
  echo "    Account — Cloudflare Pages: Edit" >&2
  echo "    Zone    — DNS: Edit (for tortok.app)" >&2
  echo "" >&2
  echo "  Your Account ID is visible in the URL of any Cloudflare dashboard" >&2
  echo "  page: https://dash.cloudflare.com/<ACCOUNT_ID>/..." >&2
  exit 1
fi

PROJECT_NAME="tortok-web"
PRODUCTION_BRANCH="main"
PUBLIC_DIR="$REPO_ROOT/web/public"

# ── Confirm web/public/ exists and has content ────────────────────────────────
if [[ ! -d "$PUBLIC_DIR" ]]; then
  echo "deploy-web: $PUBLIC_DIR not found; nothing to deploy." >&2
  exit 1
fi

WRANGLER="$REPO_ROOT/node_modules/.bin/wrangler"
if [[ ! -x "$WRANGLER" ]]; then
  echo "deploy-web: wrangler not found at $WRANGLER" >&2
  echo "  Run \`npm install\` in the repo root first." >&2
  exit 1
fi

# ── Create Pages project if it doesn't exist ─────────────────────────────────
echo "→ Checking Pages project '$PROJECT_NAME'…"

existing=$(
  "$WRANGLER" pages project list 2>/dev/null \
  | grep -F "$PROJECT_NAME" || true
)

if [[ -z "$existing" ]]; then
  echo "  Project not found — creating '$PROJECT_NAME'…"
  "$WRANGLER" pages project create "$PROJECT_NAME" \
    --production-branch "$PRODUCTION_BRANCH"
  echo "  Project created."
else
  echo "  Project '$PROJECT_NAME' already exists — skipping creation."
fi

# ── Custom domain note (manual one-time step) ─────────────────────────────────
# Wrangler 4.x has no `pages domain` subcommand; custom-domain binding
# must be done once in the dashboard. The script prints the exact URL so
# the user can go straight there. On subsequent runs this is informational
# only — there is no way to programmatically detect whether the domain is
# already bound without hitting the Cloudflare API directly, which is
# intentionally avoided to reduce fragility.
echo ""
echo "→ Custom domain binding (tortok.app):"
echo "  Wrangler 4.x cannot bind custom domains via the CLI."
echo "  If you haven't already done this, go to:"
echo "    https://dash.cloudflare.com/${CLOUDFLARE_ACCOUNT_ID}/pages/view/${PROJECT_NAME}/domains"
echo "  and add 'tortok.app' as a custom domain. This is a one-time step."
echo ""

# ── Deploy ────────────────────────────────────────────────────────────────────
# Wrangler reads CLOUDFLARE_ACCOUNT_ID from the env automatically; no flag needed.
echo "→ Deploying $PUBLIC_DIR to '$PROJECT_NAME' (branch: $PRODUCTION_BRANCH)…"
"$WRANGLER" pages deploy "$PUBLIC_DIR" \
  --project-name "$PROJECT_NAME" \
  --branch "$PRODUCTION_BRANCH"

echo ""
echo "deploy-web: done."
