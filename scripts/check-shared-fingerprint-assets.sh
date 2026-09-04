#!/usr/bin/env bash
# Check that the copies of the shared fingerprint assets are identical.
#
# Two assets are shared rather than translated: the page init payload, which all
# three implementations send to Chrome, and the limitations catalogue, which all
# three publish as data. npm, PyPI and crates.io each package a single directory
# and none of them can reference a file outside it, so the bytes have to be
# duplicated. Duplication without a check is how selenium-stealth and
# playwright_stealth drifted away from the puppeteer-extra evasions they were
# copied from; this script turns that silent drift into a failed build.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Each entry is "canonical copy copy...".
assets=(
  "js/src/fingerprint/init-payload.js \
   python/src/browser_commander/fingerprint/init_payload.js \
   rust/src/fingerprint/init_payload.js"
  "js/src/fingerprint/limitations.json \
   python/src/browser_commander/fingerprint/limitations.json \
   rust/src/fingerprint/limitations.json"
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
