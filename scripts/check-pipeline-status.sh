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
# A cancellation is only explained by a supersede: a newer commit on the same
# branch whose run cancelled this one. So before excusing a cancelled job the
# script asks two questions. Is the commit this run tests still the head of its
# branch? If it is, nothing overtook the run. And can a newer run cancel this
# job at all? A job with `cancel-in-progress: false` (the release writers' shared
# `main-writer` group) queues behind the newer run instead, so its cancellation
# is a timeout or a manual stop. Only a superseded run's
# `cancel-in-progress: true` jobs are reported as a warning; every other
# cancellation, on every branch, fails the run. The per-job value comes from
# the workflow file, found through GITHUB_WORKFLOW_REF and read by
# scripts/read-job-cancel-in-progress.mjs; an expression or anything else it
# cannot read counts as "cannot be superseded".
#
# Until issue #128 this script only looked at pushes to `main`. A pull request
# whose test job hit `timeout-minutes` therefore passed its gate with a
# warning, and a cancelled writer on a superseded `main` run was excused
# although no newer run could have cancelled it.
#
# Hosted-runner acquisition failures can instead appear as `abandoned` in
# toJSON(needs), even when the check conclusion is cancelled (run 37362314527).
# Reject undocumented or missing results rather than claiming those jobs passed.
#
# Usage (in a job that `needs:` every other job in the workflow):
#   env:
#     NEEDS_JSON: ${{ toJSON(needs) }}
#     RUN_SHA: ${{ github.event.pull_request.head.sha || github.sha }}
#     BRANCH_NAME: ${{ github.head_ref || github.ref_name }}
#   run: bash scripts/check-pipeline-status.sh
#
# Environment:
#   NEEDS_JSON       toJSON(needs) of a job that needs every other job (required)
#   RUN_SHA          the commit this run is testing; for a pull request the
#                    head commit, not the merge commit github.sha names
#   BRANCH_NAME      the branch a newer push would move (default "main")
#   BRANCH_HEAD_SHA  skip the `git ls-remote` lookup and use this value instead
#   GIT_REMOTE       remote for that lookup (default "origin")
#   WORKFLOW_FILE    workflow to read job concurrency from (default: the file
#                    GITHUB_WORKFLOW_REF names, under the repository root)
#   PIPELINE_STATUS_VERBOSE=1  trace each cancelled job's classification
#
# Adopted from the link-foundation pipeline templates, where the same script is
# `scripts/check-pipeline-status.sh` in all three languages; the
# unexpected-result check is an addition, see dev/log/issues/81/pulls/82/analysis.
set -euo pipefail

: "${NEEDS_JSON:?NEEDS_JSON is required (pass toJSON(needs))}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
branch_name="${BRANCH_NAME:-${MAIN_BRANCH:-main}}"

trace() {
  if [ "${PIPELINE_STATUS_VERBOSE:-0}" = "1" ]; then
    echo "[pipeline-status] $*" >&2
  fi
}

select_by_result() {
  # shellcheck disable=SC2016 # the single quotes keep the script away from bash.
  NEEDS_JSON="$NEEDS_JSON" WANT_RESULT="$1" node --input-type=module -e '
    const needs = JSON.parse(process.env.NEEDS_JSON);
    const unexpected = process.env.WANT_RESULT === "unexpected";
    const known = ["success", "skipped", "failure", "cancelled"];
    const jobs = Object.entries(needs)
      .filter(([, value]) => unexpected
        ? !known.includes(value?.result)
        : value?.result === process.env.WANT_RESULT)
      .map(([name, value]) => unexpected
        ? `${name} (${value?.result ?? "missing"})`
        : name);
    console.log(jobs.join(", "));
  '
}

# Answers "is a newer run already testing this branch?". An unresolvable head
# is treated as "not superseded": a missed supersede costs one noisy failure, a
# missed overrun costs a silent one.
run_is_superseded() {
  local head="${BRANCH_HEAD_SHA:-}"

  if [ -z "$head" ]; then
    head="$(git ls-remote "${GIT_REMOTE:-origin}" "refs/heads/${branch_name}" 2>/dev/null | awk 'NR == 1 { print $1 }')"
  fi

  if [ -z "$head" ] || [ -z "${RUN_SHA:-}" ]; then
    echo "Could not compare this run's commit with the head of ${branch_name}; assuming it is current." >&2
    return 1
  fi

  echo "This run tests ${RUN_SHA}; ${branch_name} is at ${head}."
  [ "$head" != "$RUN_SHA" ]
}

# The workflow file this gate belongs to: WORKFLOW_FILE, or the path in
# GITHUB_WORKFLOW_REF ("owner/repo/.github/workflows/x.yml@ref") under the
# repository root, whichever directory the step runs in.
resolve_workflow_file() {
  local ref
  if [ -n "${WORKFLOW_FILE:-}" ]; then
    printf '%s' "$WORKFLOW_FILE"
    return 0
  fi
  ref="${GITHUB_WORKFLOW_REF:-}"
  ref="${ref%%@*}"
  case "$ref" in
    */.github/*) printf '%s/.github/%s' "$repo_root" "${ref#*/.github/}" ;;
    *) return 1 ;;
  esac
}

# Prints <job><TAB><supersede|overrun><TAB><reason> for each cancelled job.
classify_cancellations() {
  local names="$1" superseded="$2" workflow reason="" table="" name value
  local policy_name policy_value

  if ! workflow="$(resolve_workflow_file)"; then
    reason="the gate could not identify its workflow (GITHUB_WORKFLOW_REF is unset)"
  elif [ ! -f "$workflow" ]; then
    reason="the gate could not read ${workflow}"
  elif ! table="$(WORKFLOW_FILE="$workflow" JOB_NAMES="$names" node "${script_dir}/read-job-cancel-in-progress.mjs" 2>&1)"; then
    reason="the gate could not read job concurrency from ${workflow}: ${table}"
    table=""
  fi

  while IFS= read -r name; do
    [ -z "$name" ] && continue
    value="unknown"
    while IFS=$'\t' read -r policy_name policy_value; do
      if [ "$policy_name" = "$name" ]; then
        value="$policy_value"
        break
      fi
    done <<<"$table"
    trace "cancelled ${name}: cancel-in-progress=${value}, superseded=${superseded}"

    if [ "$superseded" != yes ]; then
      printf '%s\toverrun\t%s\n' "$name" \
        "the run is still the head of ${branch_name}, so nothing overtook it"
      continue
    fi

    case "$value" in
      true)
        printf '%s\tsupersede\t%s\n' "$name" \
          "it sets cancel-in-progress: true, so a newer run can cancel it" ;;
      false)
        printf '%s\toverrun\t%s\n' "$name" \
          "it sets cancel-in-progress: false, so a newer run queues behind it" ;;
      none)
        printf '%s\toverrun\t%s\n' "$name" \
          "it has no job- or workflow-level concurrency group" ;;
      missing)
        printf '%s\toverrun\t%s\n' "$name" \
          "${workflow} declares no job by that name" ;;
      *)
        printf '%s\toverrun\t%s\n' "$name" \
          "${reason:-its cancel-in-progress is an expression or otherwise unreadable}" ;;
    esac
  done <<<"$names"
}

failed="$(select_by_result failure)"
cancelled="$(select_by_result cancelled)"
unexpected="$(select_by_result unexpected)"

echo "Failed jobs:    ${failed:-<none>}"
echo "Cancelled jobs: ${cancelled:-<none>}"
echo "Unexpected job results: ${unexpected:-<none>}"

status=0

if [ -n "$failed" ]; then
  echo "::error::Pipeline failed. Failing jobs: ${failed}"
  status=1
fi

if [ -n "$unexpected" ]; then
  echo "::error::Pipeline has unexpected job results: ${unexpected}. Required jobs must complete with a recognized result."
  status=1
fi

if [ -n "$cancelled" ]; then
  superseded=no
  if run_is_superseded; then
    superseded=yes
  fi

  superseded_jobs=""
  overrun_jobs=""
  while IFS=$'\t' read -r job verdict why; do
    [ -z "$job" ] && continue
    echo "  ${job}: ${why}"
    if [ "$verdict" = supersede ]; then
      superseded_jobs="${superseded_jobs:+${superseded_jobs}, }${job}"
    else
      overrun_jobs="${overrun_jobs:+${overrun_jobs}, }${job}"
    fi
  done < <(classify_cancellations "${cancelled//, /$'\n'}" "$superseded")

  if [ -n "$superseded_jobs" ]; then
    echo "::warning::Cancelled jobs in a superseded run: ${superseded_jobs}. ${branch_name} has moved on and these jobs cancel in progress, so the newer run covers them."
  fi
  if [ -n "$overrun_jobs" ]; then
    echo "::error::Pipeline has cancelled jobs: ${overrun_jobs}. No supersede accounts for them; a job killed by 'timeout-minutes' is reported as cancelled, which would otherwise hide the failure (see docs/CI-TIMEOUT-BUDGETS.md)."
    status=1
  fi
fi

if [ "$status" -eq 0 ]; then
  echo "All required jobs succeeded or were legitimately skipped."
fi

exit "$status"
