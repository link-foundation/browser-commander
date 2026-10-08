#!/usr/bin/env bash
# Verify that a packed automation install works without the native SQLite addon.
set -euo pipefail
issue138_root="$(cd "$(dirname "$0")/../.." && pwd)"
issue138_install="$(mktemp -d)"
trap 'rm -rf "$issue138_install"' EXIT
cd "$issue138_root/js"
npm pack --pack-destination "$issue138_install" > "$issue138_install/pack.txt"
cd "$issue138_install"
npm install --omit=optional --ignore-scripts --no-audit --no-fund ./browser-commander-*.tgz
node --input-type=module -e '
  import assert from "node:assert/strict";
  import { createRequire } from "node:module";
  import { findFirst, hasText, BrowserLaunchError } from "browser-commander";
  const require = createRequire(import.meta.url);
  assert.throws(() => require.resolve("better-sqlite3"), { code: "MODULE_NOT_FOUND" });
  assert.equal(typeof findFirst, "function");
  assert.equal(typeof hasText, "function");
  assert.equal(typeof BrowserLaunchError, "function");
  console.log("Packed import works without optional SQLite");
'
