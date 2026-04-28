#!/usr/bin/env bash
# List booted iOS simulators and run `expo run:ios` on a chosen one.
#
# Usage:
#   scripts/ios-launch.sh
#
# If exactly one sim is booted, uses it without prompting.
# If multiple are booted, prompts to pick.
# If none are booted, prints a hint to boot one.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TORTOK="$REPO_ROOT/tortok"

# Collect booted iOS sims as "UDID<TAB>Name" via simctl's JSON output.
booted=$(xcrun simctl list devices -j | python3 -c "
import json, sys
data = json.load(sys.stdin)
for runtime, devs in data['devices'].items():
    if 'iOS' not in runtime:
        continue
    for d in devs:
        if d.get('state') == 'Booted':
            print(d['udid'] + '\t' + d['name'])
")

if [[ -z "$booted" ]]; then
  echo "No booted iOS simulators."
  echo "Boot one with:  xcrun simctl boot <UDID>"
  echo "List options:   xcrun simctl list devices available | grep iPhone"
  exit 1
fi

lines=()
while IFS= read -r line; do
  lines+=("$line")
done <<<"$booted"

if [[ ${#lines[@]} -eq 1 ]]; then
  IFS=$'\t' read -r udid name <<<"${lines[0]}"
  echo "Using only booted sim: $name ($udid)"
else
  echo "Booted sims:"
  i=1
  for line in "${lines[@]}"; do
    IFS=$'\t' read -r u n <<<"$line"
    printf "  %d) %s  (%s)\n" "$i" "$n" "$u"
    i=$((i + 1))
  done
  echo
  read -rp "Pick one [1-${#lines[@]}]: " choice
  if ! [[ "$choice" =~ ^[0-9]+$ ]] || (( choice < 1 || choice > ${#lines[@]} )); then
    echo "Invalid selection."
    exit 1
  fi
  IFS=$'\t' read -r udid name <<<"${lines[$((choice - 1))]}"
  echo "→ $name ($udid)"
fi

echo
cd "$TORTOK"
exec npx expo run:ios --device "$udid"
