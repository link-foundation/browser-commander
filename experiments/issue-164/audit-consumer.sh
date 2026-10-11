#!/usr/bin/env bash
# Audit a fresh installation of the packed package, without the repository lock.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
consumer_dir=$(mktemp -d)
trap 'rm -rf "$consumer_dir"' EXIT

cd "$repo_root/js"
npm pack --ignore-scripts --pack-destination "$consumer_dir" --json > "$consumer_dir/pack.json"
tarball=$(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))[0].filename)' "$consumer_dir/pack.json")

cd "$consumer_dir"
printf '%s\n' '{"name":"browser-commander-consumer-audit","version":"1.0.0","private":true}' > package.json
# Lifecycle scripts and native builds are unnecessary for dependency resolution.
npm install --package-lock-only --ignore-scripts --omit=dev --no-audit "$consumer_dir/$tarball"
node -e 'const lock = require("./package-lock.json"); for (const [path, entry] of Object.entries(lock.packages)) { if (path.endsWith("/command-stream")) console.log(`${path}: ${entry.version}`); }'
npm audit --package-lock-only --omit=dev --audit-level=high
