#!/usr/bin/env bash
set -euo pipefail

# Resolve waza binary
WAZA="${WAZA_BIN:-$HOME/bin/waza}"

# Get unique directories from the filtered file list passed by prek
mapfile -t skill_dirs < <(printf '%s\n' "$@" | xargs -I {} dirname "{}" | sort -u)

if [[ ${#skill_dirs[@]} -eq 0 ]]; then
  exit 0
fi

failed=0
for dir in "${skill_dirs[@]}"; do
  echo "━━━ Checking: $dir ━━━"
  if ! "$WAZA" check "$dir" --format text; then
    failed=1
  fi
done

exit $failed