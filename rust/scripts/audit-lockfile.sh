#!/usr/bin/env bash
set -euo pipefail

report=$(mktemp)
trap 'rm -f "$report"' EXIT

if RUST_LOG=warn cargo audit --file Cargo.lock --deny warnings --json > "$report"; then
  echo 'Cargo.lock passed the strict RustSec audit.'
  exit 0
else
  audit_status=$?
fi

cat "$report"

# Keep running the strict scan and allow a PR to proceed only when its sole
# finding is the existing maintenance warning. Remove this exception after
# upgrading to the command-stream release that replaces Chrono.
if [[ "$audit_status" == 1 ]] && jq -e -s '
  length == 1 and (.[0] |
    .vulnerabilities.found == false and
    .vulnerabilities.count == 0 and
    .vulnerabilities.list == [] and
    (.warnings | keys) == ["unmaintained"] and
    (.warnings.unmaintained | length) == 1 and
    (.warnings.unmaintained[0] |
      .advisory.id == "RUSTSEC-2026-0543" and
      .package.name == "chrono" and .package.version == "0.4.45"))
' "$report" > /dev/null; then
  upstream='https://github.com/link-foundation/command-stream/pull/240'
  if [[ "${GITHUB_EVENT_NAME:-}" == pull_request ]]; then
    echo "::warning title=Temporary Cargo audit exception::Allowing the sole RUSTSEC-2026-0543 maintenance warning on pull requests while the command-stream replacement awaits publication. Upstream: $upstream"
    exit 0
  fi
  echo "::error title=Upgrade command-stream to remove Chrono::Merge $upstream and publish a command-stream release to crates.io. Raise the command-stream minimum version in rust/Cargo.toml to that release, run 'cargo update -p command-stream' in rust/, and commit both Cargo.toml and Cargo.lock. Remove the temporary pull-request exception and rerun CI on the updated commit."
fi

exit "$audit_status"
