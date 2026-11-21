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
printf '%s\n' '{"name":"browser-commander-consumer","version":"1.0.0","private":true,"type":"module","allowScripts":{"node-pty":true}}' > package.json
npm install --ignore-scripts --no-audit --no-fund "$consumer_dir/$tarball" command-stream@3.0.0 links-notation@0.31.8 lino-arguments@0.4.1
cp "$repo_root/experiments/issue-168/consumer.mjs" ./consumer.mjs
node --max-old-space-size=256 consumer.mjs "$repo_root/js/tests/fixtures/traces/conformance/expected"

# Only the opt-in recording phase needs a working native PTY and render peers.
npm install --ignore-scripts --no-audit --no-fund @xterm/headless@6.0.0 @resvg/resvg-js@2.6.2 gifenc@1.0.3 node-pty@1.1.0
npm rebuild node-pty
cp "$repo_root/experiments/issue-168/capture.mjs" ./capture.mjs
node --max-old-space-size=256 capture.mjs
