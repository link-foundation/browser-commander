#!/usr/bin/env bash
# Check that the copies of the shared fingerprint assets are identical.
#
# Three assets are shared rather than translated: the page init payload, which
# all three implementations send to Chrome, the limitations catalogue, which all
# three publish as data, and the catalogue of opt-in launch restrictions (#103),
# which all three turn into browser switches. npm, PyPI and crates.io each package a single directory
# and none of them can reference a file outside it, so the bytes have to be
# duplicated. Duplication without a check is how selenium-stealth and
# playwright_stealth drifted away from the puppeteer-extra evasions they were
# copied from; this script turns that silent drift into a failed build.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Each entry is "canonical copy copy...".
assets=(
  "js/extension/manifest.json \
   python/src/browser_commander/browser/extension_assets/manifest.json \
   rust/src/browser/extension_relay/extension_assets/manifest.json"
  "js/extension/background.js \
   python/src/browser_commander/browser/extension_assets/background.js \
   rust/src/browser/extension_relay/extension_assets/background.js"
  "js/extension/relay-handler.js \
   python/src/browser_commander/browser/extension_assets/relay-handler.js \
   rust/src/browser/extension_relay/extension_assets/relay-handler.js"
  "js/src/parity/probe.js \
   python/src/browser_commander/parity/probe.js \
   rust/src/browser/parity/probe.js"
  "js/src/fingerprint/init-payload.js \
   python/src/browser_commander/fingerprint/init_payload.js \
   rust/src/fingerprint/init_payload.js"
  "js/src/fingerprint/limitations.json \
   python/src/browser_commander/fingerprint/limitations.json \
   rust/src/fingerprint/limitations.json"
  "js/src/browser/launch-restrictions.json \
   python/src/browser_commander/browser/launch-restrictions.json \
   rust/src/browser/launch-restrictions.json"
  "js/src/browser/browser-sources.json \
   python/src/browser_commander/browser/browser-sources.json \
   rust/src/browser/browser-sources.json"
  "js/src/browser/migration/chromium-history.sql \
   python/src/browser_commander/browser/migration/chromium-history.sql \
   rust/src/browser/migration/chromium-history.sql"
  "js/src/browser/migration/capabilities.json \
   python/src/browser_commander/browser/migration/capabilities.json \
   rust/src/browser/migration/capabilities.json"
)

cd "$repo_root"

status=0

for asset in "${assets[@]}"; do
  # shellcheck disable=SC2206 # deliberate word splitting: the entry is a list.
  paths=($asset)
  canonical="${paths[0]}"
  copies=("${paths[@]:1}")

  echo "Checking the copies of $canonical..."

  if [ ! -f "$canonical" ]; then
    echo "error: $canonical is missing" >&2
    status=1
    continue
  fi

  for copy in "${copies[@]}"; do
    if [ ! -f "$copy" ]; then
      echo "error: $copy is missing" >&2
      status=1
      continue
    fi
    if diff -u "$canonical" "$copy"; then
      echo "ok: $copy"
    else
      echo "error: $copy differs from $canonical" >&2
      echo "       copy it with: cp $canonical $copy" >&2
      status=1
    fi
  done
done

if [ "$status" -ne 0 ]; then
  echo "The shared fingerprint assets are out of sync." >&2
  exit "$status"
fi

echo "All shared fingerprint asset copies are identical."
