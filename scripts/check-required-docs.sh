#!/usr/bin/env bash
# check-required-docs.sh
#
# Validates documentation the way the workflows validate code (CI/CD best
# practice #12): the documents a reader is promised must exist, and the three
# language READMEs must keep the section list they share.
#
# The other two halves of principle #12 are already covered elsewhere and are
# deliberately not repeated here: check-file-line-limits.sh scans every tracked
# .md file against the 1500-line limit, and links.yml runs lychee over every
# markdown file, which resolves relative paths as well as URLs. What neither of
# them notices is a document that stopped existing, or one language README
# quietly losing a section the other two still document - the drift
# docs/feature-parity.md exists to prevent.
#
# Usage:
#   bash scripts/check-required-docs.sh [ROOT]
#   bash scripts/check-required-docs.sh --list
#
# ROOT defaults to the current directory; the tests point it at a fixture tree.
# --list prints the requirement table as `path<TAB>section` lines, so a test can
# build a passing fixture from the same source the check reads.
#
# Exit code 0 = every requirement met; non-zero = one or more violations.

set -euo pipefail

ROOT="."
LIST_ONLY=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --list) LIST_ONLY=true ;;
    -h | --help)
      sed -n '2,25p' "$0"
      exit 0
      ;;
    *) ROOT="$1" ;;
  esac
  shift
done

# The sections js/, python/ and rust/ all document today. A reader who learned
# the JavaScript package should find the same shape in the other two, and a
# section dropped from one of them is exactly the kind of divergence that shows
# up as a support question rather than as a failing test.
LANGUAGE_README_SECTIONS="Installation|Core Concept: Page State Machine|Quick Start|API Reference|Extensibility / Escape Hatch|License"

# `path|section|section|...`; a bare `path` requires only that the file exists.
REQUIREMENTS=(
  "README.md|Available Implementations|Engine Support|Getting Started|Architecture|License"
  "js/README.md|${LANGUAGE_README_SECTIONS}"
  "python/README.md|${LANGUAGE_README_SECTIONS}"
  "rust/README.md|${LANGUAGE_README_SECTIONS}"
  "CLAUDE.md"
  "docs/feature-parity.md"
  "docs/CI-TIMEOUT-BUDGETS.md"
)

if [ "$LIST_ONLY" = true ]; then
  for requirement in "${REQUIREMENTS[@]}"; do
    file="${requirement%%|*}"
    sections="${requirement#*|}"
    if [ "$sections" = "$requirement" ]; then
      printf '%s\t\n' "$file"
      continue
    fi
    while [ -n "$sections" ]; do
      printf '%s\t%s\n' "$file" "${sections%%|*}"
      [ "${sections#*|}" = "$sections" ] && break
      sections="${sections#*|}"
    done
  done
  exit 0
fi

# A newline-delimited accumulator rather than an array: bash 3.2, which is what
# a macOS runner still ships, treats `${#empty[@]}` under `set -u` as an unbound
# variable, and this script runs on all three operating systems in the matrix.
FAILURES=""

# has_heading FILE SECTION
# True when SECTION appears as a level-2 heading. Prose that mentions the words
# does not count: a table of contents entry is not the section it links to.
has_heading() {
  local file="$1" section="$2"
  grep -Fxq "## ${section}" "$file"
}

echo "Checking required documentation in ${ROOT}..."

for requirement in "${REQUIREMENTS[@]}"; do
  file="${requirement%%|*}"
  path="${ROOT}/${file}"

  if [ ! -f "$path" ]; then
    echo "ERROR: required document is missing: ${file}"
    echo "::error file=${file}::Required document is missing."
    FAILURES="${FAILURES}${file} (missing)"$'\n'
    continue
  fi

  sections="${requirement#*|}"
  [ "$sections" = "$requirement" ] && sections=""

  while [ -n "$sections" ]; do
    section="${sections%%|*}"
    if ! has_heading "$path" "$section"; then
      echo "ERROR: ${file} has no \"## ${section}\" section"
      echo "::error file=${file}::Required section \"${section}\" is missing."
      FAILURES="${FAILURES}${file} (## ${section})"$'\n'
    fi
    [ "${sections#*|}" = "$sections" ] && break
    sections="${sections#*|}"
  done
done

if [ -n "$FAILURES" ]; then
  echo ""
  echo "Documentation requirements not met:"
  printf '%s' "$FAILURES" | sed 's/^/  /'
  echo ""
  echo "Restore the document or the section, or update the table in"
  echo "scripts/check-required-docs.sh if the requirement genuinely changed."
  exit 1
fi

echo "All required documents and sections are present."
