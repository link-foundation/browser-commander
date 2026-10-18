#!/usr/bin/env bash
# Compare the bash crates.io probe body (scripts/preflight-credentials.sh)
# with the Buffer encoding used by the pipeline template's
# crates-publish-preflight.mjs. Prints "match" when they are byte-identical.
set -eu
script="$(dirname "$0")/../scripts/preflight-credentials.sh"
eval "$(sed -n '/^crates_probe_body() {/,/^}/p' "$script")"
package="${1:-browser-commander}"
bash_hex=$(crates_probe_body "$package" | od -v -An -tx1 | tr -d ' \n')
node_hex=$(node -e '
const m = Buffer.from(JSON.stringify({ name: process.argv[1], vers: "0.0.0-preflight" }));
const b = Buffer.alloc(4 + m.length); b.writeUInt32LE(m.length); m.copy(b, 4);
process.stdout.write(b.toString("hex"));' "$package")
echo "bash: $bash_hex"
echo "node: $node_hex"
[ "$bash_hex" = "$node_hex" ] && echo match || { echo MISMATCH; exit 1; }
