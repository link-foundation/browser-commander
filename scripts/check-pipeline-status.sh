#!/usr/bin/env bash
# check-pipeline-status.sh
#
# Turns a cancelled required job into a visible failure.
#
# GitHub reports a job that its `timeout-minutes` killed as *cancelled*, not as
# *failed* (community discussion 38004, "timing out github action without
# 'failure' status"), and a run whose only casualty is a cancelled job carries
# the conclusion `cancelled` too. Nothing in this repository looked at that.
#
# The history shows the shape of the blind spot. Run 24045269874 is a push to
# `main` (Rust CI/CD Pipeline) whose `Auto Release`, `Build Package` and two
# `Test` jobs are all `cancelled`; the run's conclusion is `cancelled`, not
# `failure`. That one was a legitimate supersede - a second push arrived 38
# seconds later - and the release writers have since been moved to a
# non-cancellable `main-writer` concurrency group. What has not changed is that
# a check killed by its own `timeout-minutes` would look exactly the same, and
# nothing would say so.
#
# On a branch a cancelled job is almost always that supersede, so it is reported
# as a warning. On the default branch a supersede is still possible - the check
# jobs cancel each other through `${{ github.workflow }}-${{ github.ref }}-*`
# groups, which is how run 24045269874 came to be cancelled - so before failing
# the run this script asks whether the commit it is testing is still the head of
# the branch. If it is not, a newer run is already covering this ground and the
# cancellation is reported as a warning; if it is, nothing else will report it,
# so the run fails.
#
# Usage (in a job that `needs:` every other job in the workflow):
#   env:
#     NEEDS_JSON: ${{ toJSON(needs) }}
#     IS_MAIN: ${{ github.ref == 'refs/heads/main' && github.event_name == 'push' }}
#     RUN_SHA: ${{ github.sha }}
#   run: bash scripts/check-pipeline-status.sh
#
# Environment:
#   NEEDS_JSON       toJSON(needs) of a job that needs every other job (required)
#   IS_MAIN          "true" when this run is a push to the default branch
#   RUN_SHA          the commit this run is testing (github.sha)
#   MAIN_BRANCH      default branch name (default "main")
#   BRANCH_HEAD_SHA  skip the `git ls-remote` lookup and use this value instead
#
# Adopted from the link-foundation pipeline templates, where the same script is
# `scripts/check-pipeline-status.sh` in all three languages; the supersede
# lookup below is an addition, see dev/log/issues/81/pulls/82/analysis for why.
set -euo pipefail

: "${NEEDS_JSON:?NEEDS_JSON is required (pass toJSON(needs))}"
IS_MAIN="${IS_MAIN:-false}"

select_by_result() {
  NEEDS_JSON="$NEEDS_JSON" WANT_RESULT="$1" node --input-type=module -e '
    const needs = JSON.parse(process.env.NEEDS_JSON);
    const jobs = Object.entries(needs)
      .filter(([, value]) => value.result === process.env.WANT_RESULT)
      .map(([name]) => name);
    console.log(jobs.join(", "));
  '
}

# Answers "is a newer run already testing this branch?". A cancelled job on the
# default branch means an overrun when this run still points at the branch head,
# and a supersede when it does not. An unresolvable head is treated as "not
# superseded": a missed supersede costs one noisy warning, a missed overrun costs
# a silent failure on main.
run_is_superseded() {
  local branch="${MAIN_BRANCH:-main}"
  local head="${BRANCH_HEAD_SHA:-}"

  if [ -z "$head" ]; then
    head="$(git ls-remote "${GIT_REMOTE:-origin}" "refs/heads/${branch}" 2>/dev/null | awk 'NR == 1 { print $1 }')"
  fi

  if [ -z "$head" ] || [ -z "${RUN_SHA:-}" ]; then
    echo "Could not compare this run's commit with the head of ${branch}; assuming it is current." >&2
    return 1
  fi

  echo "This run tests ${RUN_SHA}; ${branch} is at ${head}."
  [ "$head" != "$RUN_SHA" ]
}

failed="$(select_by_result failure)"
cancelled="$(select_by_result cancelled)"

echo "Failed jobs:    ${failed:-<none>}"
echo "Cancelled jobs: ${cancelled:-<none>}"

status=0

if [ -n "$failed" ]; then
  echo "::error::Pipeline failed. Failing jobs: ${failed}"
  status=1
fi

if [ -n "$cancelled" ]; then
  if [ "$IS_MAIN" = "true" ] && ! run_is_superseded; then
    echo "::error::Pipeline has cancelled jobs on main: ${cancelled}. A job killed by 'timeout-minutes' is reported as cancelled, which would otherwise hide the failure."
    status=1
  else
    echo "::warning::Cancelled jobs: ${cancelled}. This run is not the current head of its branch, or is not a push to the default branch, so the cancellation reads as a superseded run. A genuine overrun surfaces as a step budget failure instead (see docs/CI-TIMEOUT-BUDGETS.md)."
  fi
fi

if [ "$status" -eq 0 ]; then
  echo "All required jobs succeeded or were legitimately skipped."
fi

exit "$status"
