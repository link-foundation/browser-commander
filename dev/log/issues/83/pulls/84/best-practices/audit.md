# The fifteen principles, audited against this repository

Issue #83 asks the pipeline to "follow the CI/CD best practices collected in
[CI-CD-BEST-PRACTICES.md](./CI-CD-BEST-PRACTICES.md)". This file takes that
document one principle at a time and records, for each, what this repository
does, where the evidence is, and — where the answer was "nothing" — the commit
on this branch that changed it.

The copy of the practice document audited here is
[`CI-CD-BEST-PRACTICES.md`](./CI-CD-BEST-PRACTICES.md) in this directory,
fetched from `link-assistant/hive-mind@main`.

## Summary

| #   | Principle                          | Verdict                                                         |
| --- | ---------------------------------- | --------------------------------------------------------------- |
| 1   | Run checks only on relevant files  | satisfied                                                       |
| 2   | File size limits                   | satisfied                                                       |
| 3   | Automated code formatting          | satisfied                                                       |
| 4   | Static analysis and linting        | satisfied                                                       |
| 5   | Fast-fail job ordering             | **violated — fixed** `7eea70a`                                  |
| 6   | Changeset-based versioning         | **violated — fixed** `49818b9`, `ec429c2`, `43708ff`            |
| 7   | Validate the actual merge result   | satisfied                                                       |
| 8   | Pre-commit hooks                   | satisfied                                                       |
| 9   | Release automation                 | **violated — fixed** `811d1dc`, `65698af`, `cf2d03f`, `44192e3` |
| 10  | Concurrency control                | satisfied                                                       |
| 11  | Secrets detection                  | satisfied                                                       |
| 12  | Documentation validation           | **partial — completed** `96dda92`                               |
| 13  | Container images on native runners | not applicable                                                  |
| 14  | Lint the workflows themselves      | satisfied — pin refreshed `e8ccea5`                             |
| 15  | Audit the dependency tree          | satisfied                                                       |

Nine principles were already met, four were violated and are fixed on this
branch, one was half-met and is now complete, and one does not apply.

## 1. Run checks only on relevant file changes

Satisfied. `js.yml`, `python.yml` and `rust.yml` each open with a
`detect-changes` job, and every expensive job downstream is gated on its
outputs. `js.yml` and `rust.yml` share `scripts/detect-code-changes.mjs`;
`python.yml` runs its own `python/scripts/detect_code_changes.py`, so the
python-side workflow needs no Node toolchain to decide whether to start.

The detectors distinguish a documentation-only change from a code change _per
language_, so a Rust-only pull request does not start the
three-operating-system JavaScript matrix.

The one soft spot: the two detectors are separate implementations of the same
policy with no parity test between them, so they can drift. They agree today
(both classify by path prefix over `git diff --name-only` between the pull
request base and head), and neither appears in
the eight runs issue #83 lists, so this is recorded as a risk rather than
carried into a change on this branch.

## 2. File size limits

Satisfied, and synchronized, which is the part the principle emphasises.
`scripts/check-file-line-limits.sh` enforces 1500 lines (warning at 1350) over
every tracked `.js`, `.mjs`, `.cjs`, `.md`, `.py`, `.rs` and workflow file, and
`js/eslint.config.js:117` sets `'max-lines': ['error', 1500]` — the same number,
so ESLint and the repository-wide gate cannot disagree about what "too large"
means.

`git ls-files` rather than `find` is how build output is excluded, which means
the exclusion list cannot rot.

## 3. Automated code formatting

Satisfied in all three languages, each with the language's own formatter rather
than a lowest common denominator: `prettier --check` (js), `ruff format --check`
(python), `cargo fmt --all -- --check` (rust). Each is a CI job _and_ a
pre-commit hook running the identical command, pinned by
`js/tests/unit/scripts/pre-commit-config.test.js`.

One gap that is deliberate and recorded rather than fixed: repository-root
markdown and YAML are not prettier-checked in CI, because `js/package.json`
scopes `prettier --check .` to `js/`. Extending it would put `dev/log/`
evidence files — verbatim CI logs and quoted upstream output — under a
formatter that would rewrite them.

## 4. Static analysis and linting

Satisfied. ESLint (js), `ruff check` and `mypy` (python), `cargo clippy
--all-targets --all-features` (rust).

Worth writing down, because it reads as a gap and is not one: the clippy line in
`rust.yml` carries no `-D warnings`. Clippy on its own exits 0 on a warning, so
that command _looks_ advisory. It is not — `.github/workflows/rust.yml:39` sets
`RUSTFLAGS: -Dwarnings` at workflow level, which makes every clippy warning
fatal for every job in the file. The pre-commit hook spells the same thing
inline (`RUSTFLAGS=-Dwarnings cargo clippy ...`) and
`js/tests/unit/scripts/pre-commit-config.test.js:179` asserts both spellings
stay present. Reading only the command line here produces a false positive; the
audit needed the workflow-level `env` to reach the right verdict.

## 5. Fast-fail job ordering

**Violated. Fixed in `7eea70a`.**

The principle wants the cheap check to gate the expensive one. The `test` jobs
in `js.yml`, `python.yml` and `rust.yml` did not wait for `lint`: three
operating systems each installing dependencies and running a suite were bought
by a formatting mistake one runner finds in under a minute.

The fix restates the dependency and, crucially, restates the _failure_: because
these jobs carry `if: !cancelled()`, and a status function overrides GitHub's
implicit "all needs succeeded" rule, adding `needs: [lint]` alone would have
been decorative — the job would still have run with `lint` red. The condition
now reads `!cancelled() && !contains(needs.*.result, 'failure') && ...`.

`scripts/check-ci-workflows.mjs` grew a permanent rule (`checkFastFailOrdering`)
so the ordering cannot regress, and it accepts a transitive path to `lint` — the
Rust `coverage` job reaches it through `test` and needed no change. Five tests
in `js/tests/unit/scripts/ci-workflow-policy.test.js` pin both the rule and its
non-findings.

## 6. Changeset-based versioning

**Violated. Fixed in `49818b9`, `ec429c2` and `43708ff`.**

`changeset version` was aborting mid-run on the release runner: with the default
`"format": "auto"`, `@changesets/format` walks `dprint, deno, oxfmt, biome,
prettier` and picks the first formatter whose config file it finds. An orphaned
`js/deno.json` that no workflow ever used won over the prettier the package
actually depends on, and `deno` is the single entry in that table with no
`packageName` — it is spawned straight off `PATH` with no npx fallback, and
GitHub's `ubuntu-latest` has no deno.

The result was a release that shipped but did not clean up after itself: the
consumed changeset survived to be published a second time, and the half-written
`CHANGELOG.md` kept trailing whitespace that fails `prettier --check`. Fixed by
pinning the formatter, deleting the orphaned config, and adding
`js/tests/unit/scripts/changeset-formatter.test.js`, which fails on any
formatter this package cannot actually run and on any changeset the changelog
already records as released.

Reproduction: `experiments/ci-repro/repro-changesets-format-detect.mjs`.
Reported upstream as [`changesets/format#45`](../templates/upstream-reports/changesets-format-deno-detect.md).

## 7. Validate the actual merge result

Satisfied. `scripts/simulate-fresh-merge.sh` runs in `js.yml`, `python.yml` and
`rust.yml`, each with `fetch-depth: 0` so the merge base exists. This is the
principle's own point: a green pull request built from a stale head is not
evidence about what lands on `main`.

## 8. Pre-commit hooks

Satisfied, and enforced rather than documented. `.pre-commit-config.yaml` runs
the same commands the workflows run, and
`js/tests/unit/scripts/pre-commit-config.test.js` holds a table of
`(hook id, workflow, command)` triples and fails when a hook and its workflow
drift apart. Adding the documentation gate in `96dda92` meant adding a row to
that table first — the test is what makes the parity claim in `README.md`
("Every hook runs the exact command its workflow runs") true.

## 9. Release automation

**Violated in four separate ways. Fixed in `811d1dc`, `65698af`, `cf2d03f`,
`44192e3`.**

- PyPI trusted publishing failed with the opaque `invalid-publisher`, after the
  build had already run. `811d1dc` turns it into a pre-flight failure that names
  the exact publisher to register. The registration itself needs a human with
  PyPI access; the pipeline now says so instead of failing at the last step.
- The Rust crate shared a tag namespace with the JavaScript package, so a
  release could attach to the wrong tag. `65698af` gives it its own.
- The Rust release re-published the same changelog every time; `ec429c2` and
  `cf2d03f` collect fragments under the version actually being released.
- `44192e3` closes the widest one: a release commit pushed with `GITHUB_TOKEN`
  does not trigger a workflow run, so the commit that ships is the one commit
  no CI run ever sees. Reported upstream against two templates —
  [js#171 and rust#159](../templates/upstream-reports/release-commit-never-validated.md).

## 10. Concurrency control

Satisfied, and machine-checked. Every job carries a `concurrency` block, and
`scripts/check-ci-workflows.mjs` enforces the two shapes the principle
distinguishes: readers get a job-scoped
`${{ github.workflow }}-${{ github.ref }}-<job>` with `cancel-in-progress: true`,
and writers (release, tag, publish) get `main-writer-${{ github.repository }}-main`
with `cancel-in-progress: false`, so two releases can never interleave.

## 11. Secrets detection

Satisfied. `quality.yml` runs secretlint with the recommended rule preset over
`**/*`, through `npx --yes` so no scanner dependency is committed to any of the
three language packages.

## 12. Documentation validation

**Half-met. Completed in `96dda92`.**

The principle asks for three things. Two were already covered:

- _size limits_ — `check-file-line-limits.sh` scans every tracked `.md` file
  against the same 1500-line limit as source;
- _broken links_ — `links.yml` runs lychee over `./**/*.md`, which resolves
  relative paths as well as URLs, with a Web Archive fallback before it fails.

The third — "verify required sections exist in key documents" — had no
counterpart, in this repository or in the templates, whose `validate-docs` job
checks file _presence_ only. `scripts/check-required-docs.sh` now checks both:
the promised documents must exist, and `js/README.md`, `python/README.md` and
`rust/README.md` must keep the six sections they share (Installation, Core
Concept, Quick Start, API Reference, Extensibility, License).

That second half is what a tri-language repository needs beyond the template. A
section dropped from one implementation's README is precisely the divergence
`docs/feature-parity.md` exists to prevent, and until this commit nothing would
have noticed it. The check runs as the `validate-docs` job in `quality.yml`, as
a pre-commit hook on `*.md`, and its tests build their fixtures from the
script's own `--list` output so the requirement table has one source.

## 13. Container images: native runners per architecture

Not applicable. `find . -iname 'Dockerfile*'` returns nothing outside `.git` and
`node_modules`: this repository publishes to npm, PyPI and crates.io and builds
no container image. There is no multi-architecture build to move onto native
runners.

Recorded rather than silently skipped, because "no Dockerfile" is a fact that
can change — if an image is ever added, this is the principle to re-read.

## 14. Lint the workflows themselves

Satisfied. `ci-policy.yml` runs three complementary checks:

- `docker://rhysd/actionlint` — as the **image**, not a bare binary, which is
  the detail the principle stresses: the image bundles shellcheck and pyflakes,
  so it lints every `run:` block. A binary without shellcheck on `PATH` skips
  every shell check and exits 0.
- `zizmorcore/zizmor-action@v0.6.2` with `min-confidence: medium` — a confidence
  floor, as the principle asks, not a severity floor.
- `scripts/check-ci-workflows.mjs` — this repository's own house rules, which is
  where the fast-fail rule from principle 5 now lives.

One drift found and corrected: the practice document names
`docker://rhysd/actionlint:1.7.12`, while this repository and all three
templates still pinned `1.7.7`. `e8ccea5` moves to `1.7.12`, verified against
the working tree first (exit 0, no findings), so the bump adds five releases of
checks without a backlog to clear.

## 15. Audit the dependency tree

Satisfied, on a schedule, which is the half the principle warns is usually
missing. `security.yml` runs weekly (`cron: '0 6 * * 1'`) as well as on push:
`npm audit --package-lock-only --audit-level=high`, `cargo audit --file
Cargo.lock`, and `python scripts/audit_dependencies.py`. All three audit the
lockfile as committed, and the npm level is set explicitly rather than left at
the default `low`.

## What this audit changed about the analysis

Two entries above were wrong on first reading and are recorded that way on
purpose:

- **Principle 4** looked violated because `rust.yml` runs `cargo clippy` with no
  `-D warnings` on the command line. It is satisfied; the flag is set once as
  workflow-level `RUSTFLAGS`. A command line is not the whole condition.
- **Principle 5** looked satisfied because `js.yml` already listed `lint` among
  its jobs. It was violated: the `test` job did not depend on it at all, and
  once the dependency was added, the `!cancelled()` already in the condition
  would have neutralised it. A dependency is not a gate unless the failure is
  restated.

Both are the same shape of mistake — reading one line of YAML as if it were the
whole rule — which is why the fast-fail check is now code in
`check-ci-workflows.mjs` rather than a paragraph in this file.
