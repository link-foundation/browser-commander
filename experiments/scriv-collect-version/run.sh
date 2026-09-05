#!/usr/bin/env bash
# Reproduce the `scriv collect --version "$BUMP_TYPE"` heading bug.
set -euo pipefail

SCRIV=${SCRIV:-scriv}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"

cat > pyproject.toml <<'TOML'
[project]
name = "fixture"
version = "0.5.3"

[tool.scriv]
format = "md"
fragment_directory = "changelog.d"
insert_marker = "<!-- scriv-insert-here -->"
main_branches = ["main"]
version = "literal: pyproject.toml: project.version"
TOML

mkdir changelog.d
printf '### Fixed\n\n- Something.\n' > changelog.d/20260101_000000_fixture.md
printf '# Changelog\n\n<!-- scriv-insert-here -->\n' > CHANGELOG.md

echo "=== bug: --version receives the bump type ==="
"$SCRIV" collect --version patch
sed -n '1,12p' CHANGELOG.md

echo
echo "=== fix: --version receives the version being released ==="
git init -q . && git add -A && git commit -qm fixture
git checkout -q -- CHANGELOG.md 2>/dev/null || true
printf '# Changelog\n\n<!-- scriv-insert-here -->\n' > CHANGELOG.md
printf '### Fixed\n\n- Something.\n' > changelog.d/20260101_000000_fixture.md
"$SCRIV" collect --version 0.5.4
sed -n '1,12p' CHANGELOG.md
