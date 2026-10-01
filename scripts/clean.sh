#!/usr/bin/env bash
# Remove build outputs and dependency folders throughout the monorepo.
#
# Usage:
#   scripts/clean.sh

set -euo pipefail

# Directories to delete wherever they appear in the tree.
remove=(
  node_modules
  dist
  out
  coverage
  .turbo
)

# Directories to skip entirely (never descended into, never deleted).
exclude=(
  .agents
  .direnv
  .git
  .github
)

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

# Expand each list into a find match group, e.g. ( -name a -o -name b ).
# The leading -false lets every real entry be prefixed with -o, so there is
# no trailing separator to trim.
remove_match=(-false)
for dir in "${remove[@]}"; do
  remove_match+=(-o -name "$dir")
done

exclude_match=(-false)
for dir in "${exclude[@]}"; do
  exclude_match+=(-o -name "$dir")
done

find . \
  -type d \( "${exclude_match[@]}" \) -prune -o \
  -type d \( "${remove_match[@]}" \) -prune -print0 \
  | while IFS= read -r -d '' target; do
      echo ">> deleting: ${target#./}"
      rm -rf "$target"
    done

echo ">> cleanup completed"
