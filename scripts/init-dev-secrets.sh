#!/usr/bin/env bash
# Generate development-only secrets and write them into backend/.env.
#
# What this does:
#   - Creates backend/.env from backend/.env.example if it doesn't exist
#   - For TURN_SECRET: if the value is empty, generates
#     a fresh random secret with `openssl rand -hex N`. If the value is
#     already set, leaves it alone (rotation is a separate manual op).
#
# Idempotent: safe to run multiple times. Only fills in missing values.
#
# Hooked into scripts/dev-up.sh so a fresh clone Just Works after
#   ./scripts/dev-up.sh
#
# Run manually with:
#   ./scripts/init-dev-secrets.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/backend/.env"
ENV_EXAMPLE="$REPO_ROOT/backend/.env.example"

# Bootstrap .env from .env.example
if [[ ! -f "$ENV_FILE" ]]; then
  if [[ ! -f "$ENV_EXAMPLE" ]]; then
    echo "init-dev-secrets: backend/.env.example missing; cannot bootstrap." >&2
    exit 1
  fi
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  echo "init-dev-secrets: created backend/.env from .env.example"
fi

# Fill a key in $ENV_FILE if it's currently empty (KEY= with nothing
# after) or missing entirely. Generates the value with `openssl rand
# -hex <bytes>` so it's URL-safe and shell-safe.
fill_if_empty() {
  local key="$1" bytes="$2"
  local current_line
  # The grep here matches "KEY=" optionally followed by anything;
  # we then check whether the right-hand side is empty.
  current_line=$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null || true)

  if [[ -z "$current_line" ]]; then
    # Key not present at all — append.
    local val
    val=$(openssl rand -hex "$bytes")
    printf '\n%s=%s\n' "$key" "$val" >> "$ENV_FILE"
    echo "init-dev-secrets: appended $key (${bytes}-byte random hex)"
    return
  fi

  local current_val="${current_line#${key}=}"
  if [[ -z "$current_val" ]]; then
    # Key present but empty — replace in-place.
    local val
    val=$(openssl rand -hex "$bytes")
    # Use a portable in-place sed (BSD sed on macOS needs the empty
    # extension arg; GNU sed accepts it too).
    sed -i.bak "s|^${key}=$|${key}=${val}|" "$ENV_FILE"
    rm -f "$ENV_FILE.bak"
    echo "init-dev-secrets: filled $key (${bytes}-byte random hex)"
    return
  fi

  echo "init-dev-secrets: $key already set, leaving it alone"
}

fill_if_empty TURN_SECRET 32
