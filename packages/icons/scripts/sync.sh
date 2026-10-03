#!/usr/bin/env bash
# Replace data/ with the technology icons from enthec/webappanalyzer, taken
# from the upstream commit that @openwapp/fingerprints is synced to.
#
# Usage:
#   scripts/sync.sh

set -euo pipefail
export LC_ALL=C

url="https://github.com/enthec/webappanalyzer.git"

package_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
data="$package_root/data"
ref="$(node -p 'require(process.argv[1]).commit' "$package_root/../fingerprints/data/upstream.json")"

checkout="$(mktemp -d)"
trap 'rm -rf "$checkout"' EXIT

git -C "$checkout" init -q
git -C "$checkout" remote add origin "$url"
git -C "$checkout" sparse-checkout set --no-cone /src/images/icons/
git -C "$checkout" fetch -q --depth 1 --filter=blob:none origin "$ref"
git -C "$checkout" checkout -q FETCH_HEAD

commit="$(git -C "$checkout" rev-parse HEAD)"
date="$(git -C "$checkout" show -s --format=%cI HEAD)"

rm -rf "$data"
cp -r "$checkout/src/images/icons" "$data"

printf '{\n  "repository": "%s",\n  "commit": "%s",\n  "date": "%s"\n}\n' \
  "${url%.git}" "$commit" "$date" > "$data/upstream.json"

echo ">> synced the icons of enthec/webappanalyzer@$commit ($date)"
