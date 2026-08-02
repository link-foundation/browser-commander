# Issue #75 — CI/CD false positives, false negatives, warnings and errors

Deep analysis for [issue #75](https://github.com/link-foundation/browser-commander/issues/75),
delivered in [PR #76](https://github.com/link-foundation/browser-commander/pull/76).

## 1. Evidence collected

| Artifact | Contents |
| --- | --- |
| `runs.json` | The 40 most recent workflow runs (`databaseId`, `name`, `conclusion`, `status`, `createdAt`, `headSha`, `headBranch`, `event`) |
| `ci-logs/run-30738733145.log` | Rust CI/CD Pipeline on `main` @ `4d100a1` |
| `ci-logs/run-30738733152.log` | JS CI/CD Pipeline on `main` @ `4d100a1` |
| `ci-logs/run-30738733159.log` | Documentation on `main` @ `4d100a1` |
| `ci-logs/run-30738733161.log` | Python CI/CD Pipeline on `main` @ `4d100a1` |
| `ci-logs/run-30727452642.log` | CI Workflow Policy @ `15efcea` |
| `ci-logs/run-30737988334.log` | Failing run @ `000ecde` on `issue-69-d8df3ab30de1` |
| `ci-logs/run-30737988335.log` | Failing run @ `000ecde` on `issue-69-d8df3ab30de1` |

Reference material: the three pipeline templates
(`link-foundation/{js,python,rust}-ai-driven-development-pipeline-template`) and
`link-assistant/hive-mind/docs/CI-CD-BEST-PRACTICES.md`, cloned and compared file
by file against `.github/workflows/**` and `scripts/**`.

## 2. Timeline

1. The three language pipelines were seeded from the templates at different
   times, so they drifted apart: `rust.yml` received `always()` guards on its
   gating jobs, `python.yml` received them only partially, and `js.yml` never
   received `needs:` on its manual release jobs at all.
2. GitHub deprecated the Node 20 action runtime (2025-09-19). Actions that had
   not moved to Node 24 started emitting `##[warning]Node.js 20 is deprecated`.
   `scripts/check-ci-workflows.mjs` was added to stop this class of drift, but
   its pattern list covered `actions/*` and `codecov` only — not
   `actions/setup-python`, which is the action the repository still pinned at v5.
3. Because the pipelines are green whenever the *reachable* jobs pass, the
   unreachable ones (`manual-release` in `python.yml`) and the never-failing ones
   (`changelog` in `python.yml` and `rust.yml`) were never noticed.

## 3. Requirements from the issue, and how each is addressed

| # | Requirement | Status |
| --- | --- | --- |
| R1 | Use all best practices from the three pipeline templates | Applied — see §4 and §5 |
| R2 | Compare every workflow and CI/CD script file against the templates | Done — full tree diff, findings in §4 |
| R3 | Fix all false positives, false negatives, warnings and errors | Done — §4 |
| R4 | Report the same defects upstream when they exist in a template | Done — §6 |
| R5 | Follow `hive-mind/docs/CI-CD-BEST-PRACTICES.md` | §5 tracks all 12 principles |
| R6 | Plan and execute everything in one pull request | This PR |

## 4. Findings, root causes and fixes

### 4.1 Warnings actually emitted by CI (true warnings)

**`##[warning]Node.js 20 is deprecated ... actions/setup-python@v5`**

- Evidence: `ci-logs/run-30738733161.log`.
- Root cause: the repository pinned `actions/setup-python@v5` (Node 20 runtime)
  in seven places in `python.yml`, while the Python template already used v6.
  `scripts/check-ci-workflows.mjs` had no `setup-python` pattern, so the guard
  that exists precisely to prevent this drift did not see it.
- Fix: all seven occurrences bumped to `@v6`; a `actions/setup-python@v[1-5]`
  pattern added to the policy checker so the drift cannot come back.

**`npm warn deprecated prebuild-install@7.1.3` / `DeprecationWarning: punycode`**

- Root cause: transitive dependencies of `better-sqlite3` and `puppeteer`. Not
  addressable in workflow YAML; noted here so it is not re-diagnosed later.

**`npm warn install-scripts ... better-sqlite3, puppeteer`**

- Not a defect: the expected consequence of the deliberate `npm ci --ignore-scripts`
  policy. `js/src/browser/browser-cookie-database.js` already falls back to the
  built-in `node:sqlite` on Node 22+, which is why the tests still pass.

### 4.2 Errors — workflows that would not parse

`if: !cancelled() && ...` written as a single-line value is **invalid YAML**: a
plain scalar may not begin with `!`, which is the tag indicator. Every such
condition was converted to a block scalar (`if: >-`), and the policy checker now
rejects `^\s*if:\s*!` so the mistake fails fast instead of breaking the workflow.

### 4.3 False negatives — gates that could not fail

| Location | Defect | Root cause | Fix |
| --- | --- | --- | --- |
| `python.yml` / `rust.yml` `changelog` | Emitted `::warning::` then `exit 0` | A missing changelog fragment was never a failure, so the gate was decorative | `::error::` + `exit 1`, with `set -euo pipefail` |
| `js.yml` `instant-release` | No `needs:` at all | The job could publish to npm with lint and tests never having run | `needs: [lint, test]` plus explicit `result == 'success'` checks |
| `js.yml` `changeset-pr` | No `needs:` at all | Same class of defect | `needs: [lint]` plus an explicit result check |
| `python.yml` `manual-release` | Unreachable | `detect-changes` is skipped on `workflow_dispatch`; without `!cancelled()`, `lint` was skipped, which skipped `manual-release` (see [actions/runner#491](https://github.com/actions/runner/issues/491)) | `!cancelled()` on `lint`, and explicit result gates on `manual-release` |
| `python.yml` `build` | Short-circuited on `github.event_name == 'push'` | A failing lint on `main` still produced a build artifact | Condition rewritten to require `lint`/`test` to be `success` or `skipped`, never `failure` |

### 4.4 Script injection surface

`origin/${{ github.base_ref }}` (python/rust changelog steps) and
`${{ github.event.inputs.description }}` (js/python/rust release steps) were
interpolated directly into `run:` bodies. On a `pull_request` event a branch name
is attacker-controlled, and a free-form `workflow_dispatch` input is controlled by
anyone who can trigger the workflow. All of them now pass through `env:`.

`bump_type` and `release_mode` are `type: choice` inputs, which GitHub constrains
to their declared options, so they remain safe to interpolate. The policy checker
encodes exactly this rule: it parses the `workflow_dispatch.inputs` block, and
flags an interpolated input inside a `run:` body only when the input is *not*
declared as `type: choice`.

### 4.5 Action version drift versus the templates

`actions/setup-python` v5 → v6, `codecov/codecov-action` v6 → v7,
`peter-evans/create-pull-request` v7 → v8. All three now have policy patterns.

### 4.6 Cancellation semantics

Every `always()` was replaced by `!cancelled()`. `always()` keeps downstream work
running after a run is cancelled, which both wastes runner minutes and can let a
release writer proceed against a half-cancelled pipeline. The stale comments that
still explained the old `always()` behaviour were rewritten.

## 5. Best-practice coverage (hive-mind, 12 principles)

| # | Principle | State after this PR |
| --- | --- | --- |
| 1 | detect-changes gating | Present in js/python/rust |
| 2 | File size limits | **Added** — `scripts/check-file-line-limits.sh` + `quality.yml` |
| 3 | Automated formatting | Present (prettier, ruff, rustfmt) |
| 4 | Static analysis | Present (eslint, ruff, clippy) |
| 5 | Fast-fail job ordering | Present |
| 6 | Changeset-based versioning with docs-only exemptions | Present; the changelog gates now actually fail |
| 7 | Validate the actual merge result | Not yet — see §7 |
| 8 | Pre-commit hooks | Present (husky) |
| 9 | Release automation, no manual version changes | Releases are now gated; a version-modification check is still open (§7) |
| 10 | Concurrency control | Present and enforced by the policy checker |
| 11 | Secrets detection | **Added** — secretlint in `quality.yml` + `.secretlintrc.json` |
| 12 | Documentation validation | Partially — line limits added; link checking still open (§7) |

## 6. Upstream reports

The same defects exist in the templates the repository was seeded from and are
reported there, each with a reproducible example, a workaround and a code fix:

- js template — `instant-release` and `changeset-pr` publish without `needs:` on lint/test.
- js/python/rust templates — free-form `workflow_dispatch` inputs and
  `github.base_ref` interpolated into `run:` bodies.
- python/rust templates — changelog fragment checks that warn but never fail.

## 7. Deliberately left open

These are genuine template features that are not defects in the current pipeline,
and each is a self-contained change better reviewed on its own:

- Fresh-merge simulation (principle 7) — needs a per-language build harness.
- Version-modification check (principle 9) — needs a per-language version-file parser.
- Link checking / `validate-docs` (principle 12) — needs a link allow-list first.
- Coverage jobs for Python and Rust.

## 8. Verification

- All six workflow files parse as YAML.
- `node scripts/check-ci-workflows.mjs` passes for all six.
- `scripts/check-file-line-limits.sh` passes.
- secretlint passes with `.secretlintrc.json`.
- `npm run lint`, `npm run format:check` pass.
- `npm test`: 512 pass, 6 fail — all six are `browser-cookies.test.js` cases that
  need `node:sqlite`, which the local Node 20.20.2 does not provide. CI runs
  Node 24, where the same tests pass; the failures are an artefact of the local
  toolchain and are unrelated to this change.
