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
a second push arrived 38 seconds later and superseded it — but a job killed by
its own `timeout-minutes` would have looked exactly the same, and nothing would
have said so. That is a false negative: CI is green (or at least not red) while
a check did not finish.

Reproduction, on any branch:

```yaml
jobs:
  demo:
    runs-on: ubuntu-24.04
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
(default 10), `BUDGET_POLL_SECONDS` (default 1, fractions allowed),
`BUDGET_KILL_SECONDS`, `BUDGET_CAPTURE_OUTPUT`, `BUDGET_SUDO_KILL` and
`BUDGET_STATE_PARENT` (default `RUNNER_TEMP`); the script header documents each.
On Windows runners Git Bash may not support process groups, so the wrapper
falls back to signalling the direct child.

The wrapper is the link-foundation pipeline templates' version (issue #128):
the command's output goes through files, so a child that survives the command
cannot hold the caller's pipe open; group liveness is read from the process
table, so zombies do not count as running; and processes that outlive even
`SIGKILL` are listed by name.

When the cause of an overrun is not visible in the log — the issue #128 Windows
doc-test step printed nothing for its whole budget — re-run the job with
**debug logging** enabled. GitHub then sets `RUNNER_DEBUG=1`, and the wrapper
traces its liveness and signalling decisions and lists what was still running
at the moment the budget ran out. `BUDGET_VERBOSE=1` does the same without a
re-run; both are off by default.

## The gate

[`scripts/check-pipeline-status.sh`](../scripts/check-pipeline-status.sh) runs
in a `pipeline-status` job that `needs:` every other job of its workflow, in all
ten workflows. It fails the run when a job failed, and — because a cancelled
job is the shape a timeout kill takes — when a job was cancelled on the default
branch while this run still points at the branch head. When the run no longer
points at the branch head, a newer run is already covering the same ground and
the cancellation is reported as a warning instead, so superseding a `main` push
does not paint the superseded run red.

Hosted-runner acquisition failures can report `abandoned` in the dependency
results even though their check conclusion is `cancelled`. The gate rejects
any result outside `success`, `failure`, `cancelled` and `skipped`, including
missing results, on every branch. It names the job and unexpected result rather
than reporting that all required jobs succeeded.

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

| Workflow     | Job              | Backstop | Step                                 | Budget | Measured         |
| ------------ | ---------------- | -------- | ------------------------------------ | ------ | ---------------- |
| `js.yml`     | `test`           | 20 min   | Node.js test suite                   | 300s   | 1–5s             |
| `python.yml` | `test`           | 20 min   | pytest suite                         | 300s   | 5–10s            |
| `rust.yml`   | `test`           | 20 min   | Rust test suite                      | 480s   | 23–86s           |
| `rust.yml`   | `coverage`       | 15 min   | Rust code coverage                   | 480s   | 10s              |
| `docs.yml`   | `build-docs`     | 15 min   | Rust API docs                        | 480s   | 58s              |
| `parity.yml` | `parity`         | 40 min   | Fingerprint parity suite             | 1200s  | 26s              |
| `parity.yml` | `parity`         | 40 min   | WebDriver suite                      | 300s   | 44s              |
| `parity.yml` | `cli`            | 40 min   | CLI and API coverage suites          | 300s   | 30s              |
| `parity.yml` | `snapshots`      | 30 min   | Rust native snapshots and parity     | 600s   | —                |
| `parity.yml` | `snapshots`      | 30 min   | Python native snapshot launches      | 180s   | —                |
| `parity.yml` | `snapshots`      | 30 min   | Python headful real-browser launches | 180s   | 22s (local)      |
| `parity.yml` | `snapshots`      | 30 min   | Rust launch and connect smokes       | 300s   | not run locally  |
| `parity.yml` | `engine-suites`  | 30 min   | Engine lifecycle suites              | 1200s  | 150–231s (local) |
| `parity.yml` | `fixture-suites` | 40 min   | React fixture suites                 | 1500s  | 297–299s (local) |

`rust.yml` no longer has a separate doc-test step (issue #128): `cargo test
--all-features` already runs the doc tests, and the repeat with the default
feature set rebuilt the crate, cost ~77s per OS and once stalled silently on
Windows until its 180s budget killed it. The Windows job still caches
`rust/target`, unlike the Rust template: with it only one or two crates are
recompiled and the suite takes 178–198s, while the restore costs 47–87s and a
fresh save ~5 minutes of post-job time. A cold Windows build would take most
of the 480s budget.

The `snapshots`, `engine-suites` and `fixture-suites` rows marked _local_ came
in with issue #128, which found real-browser suites that skip without
`RUN_E2E` (or are `#[ignore]`d) and that no workflow ran, so CI stayed green
whatever they did. Their measurements are from a local Linux run under
`xvfb-run` and should be replaced by CI timings once the jobs have run. The
Rust smokes could not be built locally (the container's 3 GB memory limit
kills `rustc` on `chromiumoxide_cdp`), so their budget rests on the 600s the
same job already allows for compiling and running the native snapshot tests.
The `snapshots` backstop went from 20 to 30 minutes to fit the two new budgets.
[`js/tests/unit/scripts/e2e-suite-coverage.test.js`](../js/tests/unit/scripts/e2e-suite-coverage.test.js)
now fails when a suite is neither run by a workflow nor listed as manual-only
with a reason.

The `parity` backstop went from 30 to 40 minutes when the WebDriver suite joined
the job (issue #104): the two budgets sum to 1500s, above the 1260s that 70% of
30 minutes allows.

The `no-openssl` job in `rust.yml` is deliberately unwrapped: it runs in a
`rust:slim-bookworm` container that has no `bash` on `PATH`, so GitHub falls
back to `sh -e` there and the wrapper could not run.

## Release preflight

A timeout is not the only way a release fails late. Run 37509328334 built,
tested and versioned the Python package on `main` and only then failed at
"Publish to PyPI" with `invalid-publisher`: PyPI had no trusted publisher for
this repository and workflow, and nothing before the publish step asked
(issue #128). Principle 16 of the pipeline templates — "Prove You Can Publish
Before You Build" — moves that question to the start of the run.

[`scripts/preflight-credentials.sh`](../scripts/preflight-credentials.sh) runs
in a `release-preflight` job (5-minute backstop, no build) in `python.yml`,
`js.yml` and `rust.yml`, in parallel with lint and tests. `PREFLIGHT_REGISTRIES`
picks the probe:

| Workflow     | Registry | Probe                                                                                            |
| ------------ | -------- | ------------------------------------------------------------------------------------------------ |
| `python.yml` | `pypi`   | exchanges the job's OIDC token at PyPI's `/_/oidc/mint-token`, as the publish action does        |
| `js.yml`     | `npm`    | exchanges the job's OIDC token at npm's trusted-publishing token endpoint, as `npm publish` does |
| `rust.yml`   | `crates` | sends `CARGO_TOKEN` to crates.io and checks crate ownership when the account is visible          |

The exchanges publish nothing, but they are the credential step the real
publish performs, so a passing probe means the publish will be accepted.
crates.io has no dry-run write: its probe proves the token is live, not which
scopes it carries.

On a push to `main` or a manual release the job runs in **release** mode: a
refused credential, or a run that verified nothing because every probe came
back unknown (unreachable, rate-limited, unexpected status), fails the job, and
the publishing jobs, which require `needs.release-preflight.result ==
'success'`, never start. On pull requests it runs in **report** mode and only
annotates, because a fork gets neither OIDC tokens nor secrets. Every failure
is reported, not just the first, and no token is ever printed.

### Registering the PyPI trusted publisher

The PyPI probe stays red until a maintainer registers the publisher. Because
the project is not on PyPI yet, that is a _pending_ publisher, created at
<https://pypi.org/manage/account/publishing/> with:

| Field             | Value               |
| ----------------- | ------------------- |
| PyPI project name | `browser-commander` |
| Owner             | `link-foundation`   |
| Repository name   | `browser-commander` |
| Workflow name     | `python.yml`        |
| Environment name  | _(leave empty)_     |

When the preflight fails in release mode, its next step runs
[`python/scripts/explain_pypi_failure.py`](../python/scripts/explain_pypi_failure.py),
which prints the same values for the run that failed.

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
