#!/usr/bin/env bash
# Replace data/ with the fingerprints from enthec/webappanalyzer.
#
# Usage:
#   scripts/sync.sh          # latest commit on main
#   scripts/sync.sh <ref>    # any branch, tag or commit

set -euo pipefail

url="https://github.com/enthec/webappanalyzer.git"
ref="${1:-main}"

package_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
data="$package_root/data"

checkout="$(mktemp -d)"
trap 'rm -rf "$checkout"' EXIT

git -C "$checkout" init -q
git -C "$checkout" remote add origin "$url"
git -C "$checkout" sparse-checkout set --no-cone \
  /src/technologies/ /src/categories.json /src/groups.json /schema.json
git -C "$checkout" fetch -q --depth 1 --filter=blob:none origin "$ref"
git -C "$checkout" checkout -q FETCH_HEAD

commit="$(git -C "$checkout" rev-parse HEAD)"
date="$(git -C "$checkout" show -s --format=%cI HEAD)"

rm -rf "$data"
mkdir -p "$data"
cp -r "$checkout/src/technologies" "$data/technologies"
cp "$checkout/src/categories.json" "$checkout/src/groups.json" "$checkout/schema.json" "$data/"

printf '{\n  "repository": "%s",\n  "commit": "%s",\n  "date": "%s"\n}\n' \
  "${url%.git}" "$commit" "$date" > "$data/upstream.json"

echo ">> synced enthec/webappanalyzer@$commit ($date)"
