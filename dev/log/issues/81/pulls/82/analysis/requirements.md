# Requirements

Every requirement in issue #81 and in the instruction that opened this pull
request, quoted, with what it means for this repository, its current status and
the evidence that settles it. `RC-n` refers to a row in
[`root-causes.md`](root-causes.md).

Status values: **done** — implemented and verified in CI; **open** — not yet
done, with a plan below; **standing** — a rule that has to keep holding for
every later commit, enforced by a check rather than finished once.

## A. The failing runs named in the issue

The issue's table lists seven runs on `main` at `97b9896`, three of them not
passing.

| # | Requirement (verbatim) | Root cause | Status |
| --- | --- | --- | --- |
| R-1 | "Rust CI/CD Pipeline … failure … [run 33920348349]" | RC-2 — `use('command-stream')` returns a CommonJS namespace on Node 24, so `const { $ } = …` was `undefined` | done — `e69dec4` |
| R-2 | "JS CI/CD Pipeline … failure … [run 33920348338]" | RC-2, same import in `js/scripts/` | done — `e69dec4` |
| R-3 | "Python CI/CD Pipeline … failure … [run 33920348247]" | RC-1 and RC-3 — a table-blind `grep` read two `version =` lines out of `pyproject.toml`, and an unscoped `re.sub` rewrote the wrong one | done — `a120542`, `19ae7d7` |
| R-4 | The four runs listed as `success` (CI Workflow Policy 33920348329, Broken Link Checker 33920348221, Repository Quality Gates 33920348236, Documentation 33920348294) | the issue asks for false *negatives* too: three of those four passed while checking almost nothing — RC-4 (duplication gate analysed 0 files), RC-6 (no workflow linting at all), RC-8 (no dependency audit), RC-14 (pre-commit hooks never installed) | done — `aef985b`, `8fb54a9`, `94fbacc`, `a9a4064`, `d2c4819` |

## B. The four classes in the title

> "Check for all false positives, false negatives, warnings and errors in CI/CD
> and fix them all"

| # | Class | Requirement | Status |
| --- | --- | --- | --- |
| R-5 | errors | every job that fails for a real defect is fixed | done — RC-1, RC-2, RC-3, RC-5, RC-11 |
| R-6 | false negatives | every check that passes without checking anything is made to check | done — RC-4, RC-6, RC-7, RC-8, RC-14, RC-15, RC-16 |
| R-7 | false positives | no check fails for something that is not a defect | done — RC-9, RC-10, RC-12, RC-13, RC-17 |
| R-8 | warnings | no warning is left to hide the other three | done — the 10 ESLint warnings are cleared (`b63142b`, `90709f9`), and the only annotation the nine green runs still emit is the documented RC-11 one; §F records what each was |

The classes are not independent: RC-16 is the reason a *false negative* and an
*error* can be the same event. A job killed by `timeout-minutes` is reported
**cancelled**, and a run whose only casualty is a cancelled job is filed under
`cancelled` too, so nothing on the default branch turned red. Run
`24045269874` of this repository is such a run.

## C. The templates

> "Use all the best practices from CI/CD templates (check full file tree to
> compare for all GitHub workflow and CI/CD scripts file), if the same issue is
> found in template report issue also in templates"
>
> "We should compare all files, so we don't have more CI/CD errors in the future
> and reuse all the best practices from these templates."

| # | Requirement | Status |
| --- | --- | --- |
| R-9 | Compare the full file tree against `js-`, `python-` and `rust-ai-driven-development-pipeline-template` | done — [`../templates/file-tree-diff.md`](../templates/file-tree-diff.md) |
| R-10 | Adopt the practices this repository was missing | done — `simulate-fresh-merge.sh`, `detect-code-changes`, file-line limits, secretlint, version-check, `audit_dependencies.py`, `run-with-budget-warning.sh`, `check-pipeline-status.sh` |
| R-11 | Report upstream the defects that the templates share | done — seven issues filed (python#67, python#68, python#69, rust#155, rust#156, js#166, js#167); two drafts withdrawn after testing, see §F |
| R-12 | Keep the comparison from going stale | standing — `scripts/check-ci-workflows.mjs` encodes the adopted rules as a policy check that runs on every workflow change |

Note the direction of travel is not one-way. Five defects were found *in the
templates* while comparing: RC-9 (a Python audit that fails on an advisory
against `pip` itself), RC-16 (a `pipeline-status` gate with no supersede
lookup, which fails legitimate superseded runs on `main`, and which no workflow
but `release.yml` runs at all), the table-blind `grep` of RC-1, the same
table-blindness in the Rust template's `find_manifest_value`, and the `|| true`
of RC-7/RC-14 over a husky that never fails. All five are now filed upstream;
see R-11 in §F for the issues and the evidence behind each.

## D. The best-practices document

> "Follow the CI/CD best practices collected in
> https://github.com/link-assistant/hive-mind/blob/main/docs/CI-CD-BEST-PRACTICES.md"

The document is archived verbatim at
[`../research/CI-CD-BEST-PRACTICES.md`](../research/CI-CD-BEST-PRACTICES.md).
One row per numbered principle.

| # | Practice | State in this repository | Evidence |
| --- | --- | --- | --- |
| 1 | Run checks only on relevant file changes | done | `detect-changes` job in `js.yml`, `python.yml`, `rust.yml`; `scripts/detect-code-changes.mjs`, `python/scripts/detect_code_changes.py` |
| 2 | File size limits | done | `scripts/check-file-line-limits.sh` (1500 hard, 1350 warning) over every tracked file, plus per-language `check-file-size` in `python.yml` and `rust.yml` |
| 3 | Automated code formatting | done | `npm run format:check` (Prettier), `ruff format --check`, `cargo fmt --all -- --check`; all three also in `.pre-commit-config.yaml` |
| 4 | Static analysis and linting | done | ESLint, `ruff check` + `mypy src`, `cargo clippy --all-targets --all-features`; RC-15 extended ESLint to `scripts/`, `experiments/` and `rust/scripts/`, which had no linter at all |
| 5 | Fast-fail job ordering | done | `test` needs `[detect-changes, changeset-check]`, releases need `[lint, test]`; slow jobs never start before the fast ones pass |
| 6 | Changeset-based versioning | done | `js/.changeset` (@changesets/cli), `python/changelog.d` (scriv), `rust/changelog.d`; `changeset-check` exempts docs-only changes |
| 7 | Validate the actual merge result | done | `scripts/simulate-fresh-merge.sh`, called by the `lint` and `test` jobs of all three language pipelines |
| 8 | Pre-commit hooks | done | `.pre-commit-config.yaml` runs the same gates locally; RC-14 is why they were not actually installed before |
| 9 | Release automation | done | changeset, instant and manual release paths; `version-check` rejects a manual version bump in a pull request |
| 10 | Concurrency control | done | job-level groups in all nine workflows, `cancel-in-progress: true` on read-only checks, `!cancelled()` rather than `always()` in the gate conditions |
| 11 | Secrets detection | done | `secrets-scan` job (secretlint) in `quality.yml`, and `detect-private-key` in `.pre-commit-config.yaml` |
| 12 | Documentation validation | done | `docs.yml` builds the combined docs, `links.yml` runs lychee (RC-13 fixed its two false positives), and the 1500-line limit covers `docs/` |
| 13 | Container images on native runners | not applicable | this repository publishes to npm, PyPI and crates.io and builds no container image; the only container in CI is `rust:slim-bookworm` for the `no-openssl` build |
| 14 | Lint the workflows themselves | done | `ci-policy.yml` runs `docker://rhysd/actionlint:1.7.7` (the image, so shellcheck is present), `zizmorcore/zizmor-action` at `--min-confidence medium`, and the repository's own `check-ci-workflows.mjs` |
| 15 | Audit the dependency tree | done | `security.yml`: `npm audit --package-lock-only --audit-level=high`, `cargo audit --file Cargo.lock`, `python scripts/audit_dependencies.py`, CodeQL, and dependency review — all on a Monday cron as well as on push |

## E. Process requirements

From the issue and from the instruction that opened this pull request.

| # | Requirement (verbatim) | Status |
| --- | --- | --- |
| R-13 | "plan and execute everything in this single pull request" | standing — everything is in PR #82 on `issue-81-9d4c346eb143` |
| R-14 | "Download all logs and collect data related about the issue … into the ./dev/log/issues/81/pulls/82 folder" | done — `ci-logs/`, `issue/`, `pr/`, `repo/`, `research/`, `templates/` |
| R-15 | "reconstruct the timeline/sequence of events" | done — [`timeline.md`](timeline.md) |
| R-16 | "list each and every requirement from the issue" | done — this file |
| R-17 | "find the root cause of each problem" | done — [`root-causes.md`](root-causes.md), RC-1…RC-17 |
| R-18 | "propose possible solutions and solution plans for each requirement" | done — one "solution" section per RC, plus §F for what is still open |
| R-19 | "check online for known existing components/libraries that solve a similar problem" | done — `existing-solutions.md`: 13 of the 17 root causes have an off-the-shelf component, 12 are wired in, and each rejection (`alls-green`, `workflow-conclusion-action`, `osv-scanner`, `timeout(1)`) names the fact the component cannot know |
| R-20 | "add debug output and a verbose mode … Keep the default state switched off" | done — `2c1260a` adds the opt-in logger (`CI_DEBUG=1`), and `scripts/run-with-budget-warning.sh` exposes `BUDGET_WARN_PERCENT`, `BUDGET_GRACE_SECONDS`, `BUDGET_POLL_SECONDS`; all default to off or to production values |
| R-21 | "report issues on GitHub for that project … reproducible examples, workarounds, and suggestions for fixing the issue in code" | done — same seven issues; every reproduction was run before filing and every suggested fix was executed at least once |
| R-22 | "if an issue exists in multiple places, apply it in all of them" | standing — every fix was applied across `js/`, `python/` and `rust/` and across all nine workflows; the policy check and the budget tests fail when a new workflow omits one |

## F. Plans for what is still open

### R-8 — the ten ESLint warnings (done)

`npx eslint . ../scripts ../experiments` from `js/` reported 0 errors and 10
warnings when this branch started; it now reports 0 and 0. What each was, and
what was done about it:

* 2 in `scripts/check-ci-workflows.mjs` — `checkWorkflow` had 71 statements
  (max 60) and a complexity of 33 (max 30). The function grew one `if` per
  policy rule. `b63142b` gives each rule group its own named checker and has
  `checkWorkflow` sum their results, so adding a rule no longer grows one
  function.
* 8 in `experiments/`, all in the fingerprint-parity harness:

  | File | Warning | Fix |
  | --- | --- | --- |
  | `experiments/cookie-cache-parity.mjs:34` | `require-await` — async method `create` has no `await` | returns `Promise.resolve(...)` |
  | `experiments/fingerprint-parity/harness.mjs:19` | `require-await` — `readProbeSource` has no `await` | returns the `readFile` promise |
  | `experiments/fingerprint-parity/probe.js:15` | `max-lines-per-function` — 764 lines (max 300) | scoped, documented disable |
  | `experiments/fingerprint-parity/probe.js:15` | `no-unused-vars` — `collectBrowserCommanderEnvironmentReport` | scoped, documented disable |
  | `experiments/fingerprint-parity/run-flag-matrix.mjs:37` | `complexity` 50 (max 30) | `INTERESTING_PATHS` table + `projectReport` |
  | `experiments/fingerprint-parity/run-override-coverage.mjs:79` | `complexity` 53 (max 30) | `OBSERVED_PATHS` table + `projectReport` |
  | `experiments/fingerprint-parity/run-profile-application.mjs:68` | `complexity` 40 (max 30) | `CHECKS` table + `readReportPath` |
  | `experiments/fingerprint-parity/run-runtime-enable.mjs:124` | `require-await` — `captureReference` has no `await` | `return await withTempDir(...)` |

  Each was fixed in place rather than by excluding `experiments/` from the
  linter, which would have re-opened RC-15. The three complexity warnings came
  from one long chain of optional-chaining reads per runner; `readReportPath`
  and `projectReport` in `harness.mjs` replace them with a data table, and
  `js/tests/unit/experiments/fingerprint-parity-harness.test.js` pins the two
  helpers (absent levels, falsy leaves, non-identifier keys such as
  `(pointer: coarse)`). The tables were checked against the literals they
  replaced by parsing both out of `git show HEAD:<file>`: 16/16, 26/26 and
  19/19 identical.

  `probe.js` is the one place a disable is honest rather than lazy: the file is
  read as text and wrapped as `(<contents>)()` for `page.evaluate`,
  `Runtime.evaluate` and a `<script>` tag, so its single declaration has no
  caller in this repository *by construction*, and its length is the surface of
  the browser API it measures. `js/src/fingerprint/init-payload.js` already
  carries the same override for the same reason.

The CI side of R-8 was checked separately, through the annotations API rather
than by grepping logs, since a job can emit `::warning` without the word
appearing in a readable line:

```
for job in $(gh api .../actions/runs/$id/jobs --jq '.jobs[].id'); do
  gh api repos/link-foundation/browser-commander/check-runs/$job/annotations
done
```

Across all nine workflow runs, the annotations were: the 10 ESLint warnings
above, two `notice`s (Codecov upload skipped because `CODECOV_TOKEN` is not
configured, and a link-checker summary link), and one `warning` — "the
dependency graph is disabled … so actions/dependency-review-action cannot run",
which is the deliberate RC-11 annotation that replaced a silently-skipped job.
No other warning is emitted by any job.

A warning that nobody clears is indistinguishable from a warning nobody reads,
which is exactly the failure mode the issue title names.

### R-11 / R-21 — the upstream reports (done)

Seven issues filed, each with a reproduction that was run before filing, a
workaround, and the code change. Every draft was checked against the live
templates first (fresh clones of js `338fafa`, python `81c9786`, rust
`4d444d9`) and against the templates' existing issue lists, because a duplicate
report costs a maintainer the same attention as a wrong one.

| Report | Where | Verified by |
| --- | --- | --- |
| A version read out of a manifest by line shape, not by table: `grep -Po '(?<=^version = ")[^"]*'` matches `version` in every table, and `head -1` only makes the answer depend on table order | [python#67](https://github.com/link-foundation/python-ai-driven-development-pipeline-template/issues/67) | Our own run 33920348247, plus a two-table `pyproject.toml` reproducing both the multi-line `$GITHUB_OUTPUT` failure and the wrong `head -1` answer (RC-1) |
| The same defect in Rust: `find_manifest_value` (`scripts/rust-paths.rs:253`) returns the first line-anchored `key = "…"` in the file, so a member crate with `version.workspace = true` publishes **serde's** version requirement as its own | [rust#155](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/155) | Ran against the real `regex` crate: `version -> Some("1.0")`. The suggested table-tracking replacement was run on the same three manifests before it was proposed |
| `audit_dependencies.py` builds the audited venv **with** pip and audits it, and `run()` captures stdout under `check=True` so the advisory table is lost on the one run that finds something | [python#68](https://github.com/link-foundation/python-ai-driven-development-pipeline-template/issues/68) | An empty project fails its own audit on `PYSEC-2026-3721` against pip; the swallowed-stdout behaviour reproduced in four lines of Python (RC-9) |
| `check-pipeline-status.sh` is wired into `release.yml` only — so a timeout in `links.yml`, `security.yml`, `workflows.yml` (and `example-app.yml` / `docs.yml` / `desktop-release.yml`) is reported `cancelled` and nothing turns it red — and it has no branch-head lookup, so copying it into those workflows (where `cancel-in-progress: true` is unconditional) turns every rapid second push to `main` into a false error | [js#167](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/167), [python#69](https://github.com/link-foundation/python-ai-driven-development-pipeline-template/issues/69), [rust#156](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/156) | `grep -rl` over each template's workflows; the `cancel-in-progress` lines quoted per file; our run 24045269874, a push to `main` cancelled by a supersede (RC-16) |
| husky exits 0 for every failure it has — `.git can't be found`, `git command not found`, a failed `git config` — so `"prepare": "husky || true"` reports an install that set no `core.hooksPath` and installed no hook; the `js/` layout this template supports is exactly that case | [js#166](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/166) | Reproduced end to end (husky 9.1.7 prints `.git can't be found`, exits 0, `core.hooksPath` unset); the proposed verifier was run in both the broken and the working layout (RC-14) |

Two drafts were **not** filed, and the reason is the same in both cases: the
claim did not survive being checked.

- **jscpd `--fail-on-new-clones` "never names the new clones"** — false, see the
  block below.
- **The zizmor findings against the live templates** (js 58, python 39, rust
  54, at default confidence). All three templates already run zizmor with
  `--min-confidence medium`, which is the subject of the existing
  [js#160](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/160);
  and the findings that threshold hides are not defects. Python's 23
  `template-injection` findings are all
  `steps.python_layout.outputs.root`, whose only possible values are the
  literals `.` and `python` assigned inside the workflow. Rust's two
  `artipacked` findings are release-writer checkouts that hold
  `secrets.GITHUB_TOKEN` **because they push**. Filing those would have added
  exactly the noise this issue exists to remove. The 82-finding count cited
  earlier in this file is against the frozen snapshots under
  `docs/case-studies/issue-55/template-snapshots/` in *this* repository, not
  against the live templates — the two numbers are not comparable, which is
  itself worth recording.

**Withdrawn.** A fifth report against **jscpd** was drafted on the reading that
`--fail-on-new-clones` reports a *count* of new clones and never names them.
That is wrong, and testing it before filing is why it was not filed:
`experiments/ci-repro/check-jscpd-new-clone-reporting.mjs` builds a baseline,
adds one new clone and shows jscpd 5.1.2 marking it `[NEW]` with both
locations, above the count. The same marking is in this repository's own
failing run, at
`dev/log/issues/81/pulls/82/ci-logs/js-33962524078-failed.log:746`:

```
Clone found (javascript) [NEW]
 - tests/unit/scripts/check-web-archive.test.js [157:62 - 163:21] (7 lines, 51 tokens)
   tests/unit/scripts/check-web-archive.test.js [174:49 - 180:21]
```

The count on the last line is a summary of a listing, not a replacement for
one. The listing does depend on the `console` reporter staying in
`js/.jscpd.json`, which is what the experiment is kept for.

### R-19 — existing components (done)

`existing-solutions.md` records, for each root cause, what already exists that
solves it, whether this repository adopted it, and — when it did not — the
repository-specific fact the generic component cannot know. Adopted:
`actionlint` (with the bundled shellcheck and pyflakes), `zizmor`, CodeQL,
`npm audit` / `cargo-audit` / `pip-audit`, `dependency-review-action`,
`secretlint`, `lychee`, `jscpd`, `pre-commit`, Changesets, `scriv`, and the
root ESLint config. Rejected with reasons: `re-actors/alls-green` (votes on
success, and cannot tell a timeout overrun from a `concurrency` supersede,
which needs `git ls-remote` evidence from outside the run),
`technote-space/workflow-conclusion-action` (archived 16 November 2023),
`osv-scanner` (would replace three working auditors — a separate change), and
`timeout(1)` (kills the direct child, not the process group, and cannot warn
before the deadline).

It also records the one drafted claim that testing disproved: the withdrawn
jscpd report above.
