#!/usr/bin/env bash
# Check that the three copies of the fingerprint init payload are identical.
#
# The payload is one asset that all three implementations send to Chrome, but
# npm, PyPI and crates.io each package a single directory and none of them can
# reference a file outside it, so the bytes have to be duplicated. Duplication
# without a check is how selenium-stealth and playwright_stealth drifted away
# from the puppeteer-extra evasions they were copied from; this script turns
# that silent drift into a failed build.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
canonical="js/src/fingerprint/init-payload.js"
copies=(
  "python/src/browser_commander/fingerprint/init_payload.js"
  "rust/src/fingerprint/init_payload.js"
)

cd "$repo_root"

echo "Checking the shared fingerprint init payload copies against $canonical..."

if [ ! -f "$canonical" ]; then
  echo "error: $canonical is missing" >&2
  exit 1
fi

status=0
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

if [ "$status" -ne 0 ]; then
  echo "The fingerprint init payload copies are out of sync." >&2
  exit "$status"
fi

echo "All fingerprint init payload copies are identical."
