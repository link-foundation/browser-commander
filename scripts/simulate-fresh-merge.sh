#!/usr/bin/env bash
# simulate-fresh-merge.sh
#
# Merges the current tip of the base branch into the checked-out pull request
# before the calling job runs its checks.
#
# GitHub builds the `refs/pull/N/merge` ref once, when the pull request is
# opened or synchronised, and does not rebuild it when the base branch moves.
# A job that checks out that ref therefore validates a stale merge preview: the
# pull request can be green while the state that actually lands on the base
# branch is broken. Merging the live base branch here makes every subsequent
# step in the job run against the state that will exist after the merge, which
# is what catches semantic conflicts — two changes that are both individually
# correct and do not produce a textual conflict, but break each other.
#
# Usage:
#   BASE_REF=main bash scripts/simulate-fresh-merge.sh
#
# Environment variables:
#   BASE_REF         The base branch to merge with (for example "main").
#   GITHUB_BASE_REF  Used as a fallback, so the script can be called from a
#                    workflow that already exports the GitHub-provided value.
#
# Requires the repository to be checked out with `fetch-depth: 0`; a shallow
# clone has no merge base to merge against.
#
# Exit code 0 = merge succeeded or was not needed; non-zero = merge conflict.

set -euo pipefail

BASE_REF="${BASE_REF:-${GITHUB_BASE_REF:-}}"

if [ -z "$BASE_REF" ]; then
  echo "::error::Neither BASE_REF nor GITHUB_BASE_REF is set; cannot simulate a fresh merge."
  exit 1
fi

echo "=== Synchronizing pull request with the latest $BASE_REF ==="
echo ""

# The merge below creates a commit, which git refuses to do without an identity.
git config user.email "github-actions[bot]@users.noreply.github.com"
git config user.name "github-actions[bot]"

echo "Fetching latest $BASE_REF..."
git fetch origin "$BASE_REF"

CURRENT_SHA=$(git rev-parse HEAD)
BASE_SHA=$(git rev-parse "origin/$BASE_REF")

echo "Current checkout (merge preview): $CURRENT_SHA"
echo "Latest base branch ($BASE_REF):   $BASE_SHA"
echo ""

BEHIND_COUNT=$(git rev-list --count "HEAD..origin/$BASE_REF")

if [ "$BEHIND_COUNT" -eq 0 ]; then
  echo "Merge preview is up to date with $BASE_REF. No simulation needed."
  exit 0
fi

echo "Base branch has $BEHIND_COUNT new commit(s) since the pull request was opened or synced."
echo "Simulating a fresh merge so the checks below run against the real merge result..."
echo ""

if git merge "origin/$BASE_REF" --no-edit; then
  echo ""
  echo "Fresh merge simulation successful."
  echo "The checks in this job now run against the up-to-date merged state."
else
  echo ""
  echo "::error::Merge conflict detected. This pull request must be updated from $BASE_REF before it can be merged."
  exit 1
fi
