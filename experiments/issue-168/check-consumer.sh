#!/usr/bin/env bash
# Resolve a real packed consumer independently of the repository lockfile.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
consumer_dir=$(mktemp -d)
trap 'rm -rf "$consumer_dir"' EXIT

cd "$repo_root/js"
npm pack --ignore-scripts --pack-destination "$consumer_dir" --json > "$consumer_dir/pack.json"
tarball=$(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))[0].filename)' "$consumer_dir/pack.json")

cd "$consumer_dir"
printf '%s\n' '{"name":"browser-commander-links-consumer","version":"1.0.0","private":true,"type":"module"}' > package.json
npm install --ignore-scripts --omit=dev --omit=optional --no-audit --no-fund "$consumer_dir/$tarball" links-notation@0.25.2
cp "$repo_root/experiments/issue-168/consumer.mjs" ./consumer.mjs
node --max-old-space-size=256 consumer.mjs "$repo_root/js/tests/fixtures/traces/conformance/expected"
