#!/usr/bin/env bash
# check-file-line-limits.sh
#
# Enforces the documented 1500-line file limit (CI/CD best practice #2) on every
# tracked source, documentation and workflow file across all three language
# implementations (js/, python/, rust/).
#
# Large files are the main driver of merge conflicts between concurrent pull
# requests, and an oversized workflow file is the usual reason inline shell logic
# stops being reviewable. The warning threshold gives a heads-up well before the
# hard limit turns into a failing check.
#
# Files under docs/case-studies/*/template-snapshots/ are verbatim copies of
# upstream template repositories kept as evidence; reflowing them would destroy
# their value as a snapshot, so they are excluded.
#
# Usage:
#   bash scripts/check-file-line-limits.sh
#
# Exit code 0 = all files within limit; non-zero = one or more violations.

set -euo pipefail

LIMIT=1500
WARN_THRESHOLD=1350
FAILURES=()
WARNINGS=()

# check_file FILE [HINT]
# Counts lines in FILE and records a warning or a failure when it crosses the
# warning threshold or the hard limit. HINT is appended to the GitHub annotation
# to suggest a remediation.
check_file() {
  local file="$1"
  local hint="${2:-Extract code to keep files under the ${LIMIT} line limit.}"
  local line_count
  line_count=$(wc -l < "$file" | tr -d '[:space:]')
  if [ "$line_count" -gt "$LIMIT" ]; then
    echo "ERROR: $file has $line_count lines (limit: ${LIMIT})"
    echo "::error file=$file::File has $line_count lines (limit: ${LIMIT}). ${hint}"
    FAILURES+=("$file")
  elif [ "$line_count" -gt "$WARN_THRESHOLD" ]; then
    echo "WARNING: $file has $line_count lines (approaching limit of ${LIMIT}, warning threshold: ${WARN_THRESHOLD})"
    echo "::warning file=$file::File has $line_count lines (approaching limit of ${LIMIT}). ${hint}"
    WARNINGS+=("$file")
  fi
}

echo "Checking tracked source, documentation and workflow files against the ${LIMIT} line limit..."

# git ls-files is used instead of find so build output (node_modules, target,
# .venv, dist) is excluded by construction rather than by an ignore list that
# has to be kept in sync.
while IFS= read -r file; do
  case "$file" in
    docs/case-studies/*/template-snapshots/*) continue ;;
  esac
  [ -f "$file" ] || continue

  case "$file" in
    .github/workflows/*)
      check_file "$file" "Move inline scripts to the ./scripts/ folder to reduce file size."
      ;;
    *)
      check_file "$file"
      ;;
  esac
done < <(git ls-files -- '*.js' '*.mjs' '*.cjs' '*.md' '*.py' '*.rs' '.github/workflows/*.yml' '.github/workflows/*.yaml')

echo ""
if [ "${#WARNINGS[@]}" -gt 0 ]; then
  echo "The following files are approaching the ${LIMIT} line limit (>${WARN_THRESHOLD} lines):"
  printf '  %s\n' "${WARNINGS[@]}"
  echo ""
  echo "Consider extracting code to prevent concurrent pull request merge conflicts."
  echo ""
fi

if [ "${#FAILURES[@]}" -gt 0 ]; then
  echo "The following files exceed the ${LIMIT} line limit:"
  printf '  %s\n' "${FAILURES[@]}"
  echo ""
  echo "Move large inline scripts to the ./scripts/ folder to reduce file size."
  exit 1
fi

echo "All checked files are within the ${LIMIT} line limit!"
