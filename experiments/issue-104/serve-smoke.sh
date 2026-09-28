#!/usr/bin/env bash
# Smoke test of the browser-commander CLI without a browser (issue #104).
# Usage: bash experiments/issue-104/serve-smoke.sh (from the repository root)
set -u
cd "$(dirname "$0")/../../js" || exit 1
CLI=bin/browser-commander.js

node "$CLI" version
echo "exit $?"
node "$CLI" bogus
echo "exit $?"
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"version"}' \
  '{"jsonrpc":"2.0","id":2,"method":"nope"}' \
  'garbage' \
  '{"jsonrpc":"2.0","method":"version"}' \
  '[{"jsonrpc":"2.0","id":3,"method":"handle.root","params":{"name":"playwright"}},{"jsonrpc":"2.0","id":4,"method":"handle.root","params":{"name":"puppeteer"}}]' \
  '{"jsonrpc":"2.0","id":5,"method":"handle.describe","params":{"handle":"h1"}}' \
  '{"jsonrpc":"2.0","id":6,"method":"handle.get","params":{"handle":"h1","property":"chromium"}}' \
  '{"jsonrpc":"2.0","id":7,"method":"open","params":{"url":"https://example.com"}}' \
  | node "$CLI" serve --stdio
echo "exit $?"
