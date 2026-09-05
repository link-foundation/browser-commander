## Summary

`scripts/check-pipeline-status.sh` is the only thing in this template that can
tell "a job ran out of time" apart from "everything finished". It has two gaps,
and they pull in opposite directions, so fixing one without the other makes
things worse.

**1. False negative — the gate is wired into `release.yml` and nowhere else.**

```
$ grep -rl check-pipeline-status .github/workflows/
.github/workflows/release.yml
```

`links.yml`, `security.yml`, `workflows.yml` and `desktop-release.yml` have no terminal status gate at all.

A job in any of them that its `timeout-minutes` kills is reported *cancelled*,
the run's conclusion becomes `cancelled`, and nothing turns it red — the exact
blind spot #118 and #135 closed for `release.yml`.

**2. False positive waiting to happen — the gate cannot see a supersede.**

`scripts/check-pipeline-status.sh:28`:

```bash
if [ -n "$cancelled" ]; then
  if [ "$IS_MAIN" = "true" ]; then
    echo "::error::Pipeline has cancelled jobs on main: ${cancelled}. ..."
    status=1
```

On the default branch every cancellation is an error. That holds for
`release.yml`, whose check jobs carry
`cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}` and therefore are
never superseded on `main`. It does **not** hold for the workflows above:

```
.github/workflows/links.yml:47:      cancel-in-progress: true
.github/workflows/security.yml:21:      cancel-in-progress: true
.github/workflows/security.yml:40:      cancel-in-progress: true
.github/workflows/security.yml:68:      cancel-in-progress: true
.github/workflows/workflows.yml:21:      cancel-in-progress: true
.github/workflows/workflows.yml:43:      cancel-in-progress: true
```

`cancel-in-progress: true` is unconditional there, so two pushes to `main` in
quick succession cancel the first run's jobs by design. Copy the gate into those
workflows as it stands — the obvious fix for gap 1 — and every rapid second push
to `main` produces `::error::Pipeline has cancelled jobs on main`.

That is not hypothetical. `link-foundation/browser-commander` run
[24045269874](https://github.com/link-foundation/browser-commander/actions/runs/24045269874)
is a push to `main` whose jobs were cancelled by a second push 38 seconds later;
its conclusion is `cancelled`, and a gate without a supersede check calls it a
timeout.

## Reproduction

Gap 1:

```yaml
# .github/workflows/security.yml, any job
    timeout-minutes: 1
    steps:
      - run: sleep 120
```

Push to `main`. The job is annotated `The job has exceeded the maximum
execution time of 1m0s` and its conclusion is `cancelled`, not `failed` — the
behaviour this template already documents and that #118 were opened
about. The difference from `release.yml` is that this workflow has no gate job,
so the run ends `cancelled` and nothing reports it.

Gap 2: add the gate as it stands to that same workflow (`needs:` every other
job, `if: !cancelled()`,
`IS_MAIN: ${{ github.ref == 'refs/heads/main' && github.event_name == 'push' }}`)
and push twice to `main` within a few seconds. `cancel-in-progress: true`
cancels the first run's jobs, `IS_MAIN` is `true`, and the gate takes the
`status=1` branch: `::error::Pipeline has cancelled jobs on main` for a
cancellation that was correct. Run 24045269874 above is that situation in a real
repository — the only reason it was not a red error there is that the run
predates the gate.

## Workaround

Read the annotations by hand:

```sh
for job in $(gh api repos/OWNER/REPO/actions/runs/$RUN/jobs --jq '.jobs[].id'); do
  gh api repos/OWNER/REPO/check-runs/$job/annotations \
    --jq '.[] | select(.message | test("exceeded the maximum execution time"))'
done
```

That finds a real timeout, but only for a run somebody already suspected.

## Suggested fix in code

Ask whether the commit under test is still the head of the branch. A
cancellation on the default branch is an overrun when it is, and a supersede
when it is not — and that fact lives outside the `needs` context, which is why
no `needs`-only action (`re-actors/alls-green`, for instance) can decide it.

```bash
# Answers "is a newer run already testing this branch?". An unresolvable head is
# treated as "not superseded": a missed supersede costs one noisy warning, a
# missed overrun costs a silent failure on main.
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

if [ -n "$cancelled" ]; then
  if [ "$IS_MAIN" = "true" ] && ! run_is_superseded; then
    echo "::error::Pipeline has cancelled jobs on main: ${cancelled}. A job killed by 'timeout-minutes' is reported as cancelled, which would otherwise hide the failure."
    status=1
  else
    echo "::warning::Cancelled jobs: ${cancelled}. This run is not the current head of its branch, or is not a push to the default branch, so the cancellation reads as a superseded run."
  fi
fi
```

The caller passes the extra fact:

```yaml
        env:
          NEEDS_JSON: ${{ toJSON(needs) }}
          IS_MAIN: ${{ github.ref == 'refs/heads/main' && github.event_name == 'push' }}
          RUN_SHA: ${{ github.sha }}
        run: bash scripts/check-pipeline-status.sh
```

`BRANCH_HEAD_SHA` exists so unit tests can drive both readings without a
network call.

Then add the same gate job to `links.yml`, `security.yml`, `workflows.yml` and `desktop-release.yml`, each `needs:` every
other job in its workflow with `if: >- !cancelled()` — a status function is
required, or the gate inherits the implicit "every dependency succeeded"
condition and is skipped in exactly the runs it exists to report.

Worth pinning with tests: failure reported, cancellation on `main` at the branch
head reported as an error, the same cancellation behind the branch head reported
as a warning, and an unresolvable branch head failing loudly rather than
guessing.

## Where this came from

`link-foundation/browser-commander` hit both halves while eliminating every
false positive, false negative, warning and error in its CI
(link-foundation/browser-commander#81, PR link-foundation/browser-commander#82,
root cause RC-16). The gate now runs in all nine of its workflows, with
`run_is_superseded()` and seven unit cases in
`js/tests/unit/scripts/check-pipeline-status.test.js`.
