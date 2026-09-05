# CI Timeout Budgets

`timeout-minutes` is a backstop, never the deadline.

## Why a backstop is not enough

GitHub reports a job killed by `timeout-minutes` as **cancelled**, not
**failed** — see the GitHub Community discussion
[38004, "timing out github action without 'failure' status"](https://github.com/orgs/community/discussions/38004).
A run whose only casualty is a cancelled job carries the conclusion `cancelled`
as well, and `cancelled` is not `failure`: it does not turn a pull request
check red the way a failure does, and until this pull request nothing in this
repository looked at it.

The blind spot is visible in this repository's own history. Run
[24045269874](https://github.com/link-foundation/browser-commander/actions/runs/24045269874)
is a push to `main` whose `Auto Release`, `Build Package` and both `Test` jobs
are `cancelled`, and whose run conclusion is `cancelled`. That one was benign —
a second push arrived 37 seconds later and superseded it — but a job killed by
its own `timeout-minutes` would have looked exactly the same, and nothing would
have said so. That is a false negative: CI is green (or at least not red) while
a check did not finish.

Reproduction, on any branch:

```yaml
jobs:
  demo:
    runs-on: ubuntu-latest
    timeout-minutes: 1
    steps:
      - name: Slow suite
        run: sleep 120
```

The job is annotated `The job has exceeded the maximum execution time of 1m0s`,
its conclusion is `cancelled`, and the run's conclusion is `cancelled`. No job
failed.

## Per-test timeouts do not bound a suite

`node --test --test-timeout=…`, `pytest-timeout` and `cargo test` per-test
limits bound a **single test**. They do not bound a suite: 25 tests that each
finish just inside a 30-second per-test limit pass every per-test check and
still blow a 10-minute job cap. Per-test limits are worth keeping — a hung test
is better caught early — but they are not a suite deadline.

## The rule

Every long step owns an explicit budget, and every budget expires before the
job's backstop fires.

`run:` steps wrap their command in
[`scripts/run-with-budget-warning.sh`](../scripts/run-with-budget-warning.sh):

```yaml
- name: Run tests
  shell: bash
  run: bash ../scripts/run-with-budget-warning.sh 300 "Node.js test suite" npm test
```

`shell: bash` is explicit because the default shell on `windows-latest` is
PowerShell, and the path is `../scripts/…` in `js.yml`, `python.yml` and
`rust.yml` because those workflows set `defaults.run.working-directory` to the
language subdirectory.

## What the wrapper does

`scripts/run-with-budget-warning.sh SECONDS LABEL COMMAND [ARG...]`:

- runs the command in its own **process group** (`set -m`), because test
  runners spawn workers and killing only the direct child leaves orphans
  holding the runner — which is also why `timeout(1)` is not sufficient here;
- emits `::warning title=<label> is approaching its execution budget` at 70% of
  the budget, while the overrun can still be acted on;
- on expiry emits `::error title=<label> exceeded its execution budget`, sends
  `SIGTERM` to the group, waits `BUDGET_GRACE_SECONDS`, then sends `SIGKILL`;
- exits **124** on termination, matching `timeout(1)`, and otherwise passes the
  command's own exit status through unchanged.

Overrides: `BUDGET_WARN_PERCENT` (default 70), `BUDGET_GRACE_SECONDS`
(default 10), `BUDGET_POLL_SECONDS` (default 1). On Windows runners Git Bash
may not support process groups, so the wrapper falls back to signalling the
direct child.

## The gate

[`scripts/check-pipeline-status.sh`](../scripts/check-pipeline-status.sh) runs
in a `pipeline-status` job that `needs:` every other job of its workflow, in all
nine workflows. It fails the run when a job failed, and — because a cancelled
job is the shape a timeout kill takes — when a job was cancelled on the default
branch while this run still points at the branch head. When the run no longer
points at the branch head, a newer run is already covering the same ground and
the cancellation is reported as a warning instead, so superseding a `main` push
does not paint the superseded run red.

## The invariant

[`js/tests/unit/scripts/ci-timeout-budgets.test.js`](../js/tests/unit/scripts/ci-timeout-budgets.test.js)
asserts, for every job in every workflow that declares budgets, that

- each individual budget is at most **70%** of the job's `timeout-minutes`, and
- the budgets in a job sum to at most 70% of that cap, leaving headroom for the
  unbudgeted setup — checkout, toolchain installation, `npm ci`, `cargo build` —
  that runs on the same job clock.

The share matches `BUDGET_WARN_PERCENT`, so the warning the wrapper emits at 70%
of a budget is the same threshold the invariant enforces against the backstop.

## Current budgets

Budgets are set from measured step durations taken from recent successful runs,
with at least a fivefold margin, and always below 70% of the job's backstop.

| Workflow     | Job          | Backstop | Step                     | Budget | Measured |
| ------------ | ------------ | -------- | ------------------------ | ------ | -------- |
| `js.yml`     | `test`       | 20 min   | Node.js test suite       | 300s   | 1–5s     |
| `python.yml` | `test`       | 20 min   | pytest suite             | 300s   | 5–10s    |
| `rust.yml`   | `test`       | 20 min   | Rust test suite          | 480s   | 23–86s   |
| `rust.yml`   | `test`       | 20 min   | Rust doc tests           | 180s   | 6–11s    |
| `rust.yml`   | `coverage`   | 15 min   | Rust code coverage       | 480s   | 10s      |
| `docs.yml`   | `build-docs` | 15 min   | Rust API docs            | 480s   | 58s      |
| `parity.yml` | `parity`     | 30 min   | Fingerprint parity suite | 1200s  | 26s      |

The `no-openssl` job in `rust.yml` is deliberately unwrapped: it runs in a
`rust:slim-bookworm` container that has no `bash` on `PATH`, so GitHub falls
back to `sh -e` there and the wrapper could not run.

## Reference

Both scripts are adopted from the `link-foundation` pipeline templates
([js](https://github.com/link-foundation/js-ai-driven-development-pipeline-template),
[python](https://github.com/link-foundation/python-ai-driven-development-pipeline-template),
[rust](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template)),
where the same files are `scripts/run-with-budget-warning.sh` and
`scripts/check-pipeline-status.sh`. The supersede check in the gate is an
addition made here; see
[`dev/log/issues/81/pulls/82/analysis/root-causes.md`](../dev/log/issues/81/pulls/82/analysis/root-causes.md)
(RC-16).
