# Audit against the hive-mind CI/CD best practices

Source archived at `../best-practices/CI-CD-BEST-PRACTICES.md` (URLs move;
evidence should not). Fifteen principles, each checked against this repository
rather than assumed.

Most were already satisfied before this pull request — issues #55, #81 and #83
built this pipeline out. Recording them anyway is the point of an audit: an
unexamined "probably fine" is what let RC-1 sit in four places. Where a
principle was already met, the evidence is named so the claim can be
re-checked; the two rows that this pull request changes are marked.

| # | Principle | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Run checks only on relevant file changes | Met | `detect-changes` job in `js.yml`, `python.yml`, `rust.yml`; each downstream job gated on its output. `docs.yml`/`links.yml`/`ci-policy.yml` gate by `paths:` instead, which is the same idea at workflow level. |
| 2 | File size limits | Met | `scripts/check-file-line-limits.sh` (limit 1500, warns at 1350) run by `quality.yml`; the ESLint rule is kept in sync — `js/eslint.config.js:117` `'max-lines': ['error', 1500]`. The principle asks for exactly this pairing. |
| 3 | Automated formatting | Met | prettier (JS), `ruff format` (Python), `rustfmt` (Rust), all enforced in CI and mirrored in `.pre-commit-config.yaml`. |
| 4 | Static analysis and linting | Met | ESLint, `ruff` + `mypy`, `clippy`. |
| 5 | Fast-fail job ordering | Met | `test` needs `[detect-changes, changelog, lint]`; `build` needs `[detect-changes, lint, test]`; release needs the lot. Fast checks gate slow ones. |
| 6 | Changeset-based versioning | Met | changesets (JS), `scriv` (Python), `changelog.d` (Rust); docs-only PRs exempt via `detect-changes`. |
| 7 | Validate the actual merge result | Met | "Simulate fresh merge with base branch (PR only)" in all three language workflows, twice each (lint and test). |
| 8 | Pre-commit hooks | Met, and unusually well | `.pre-commit-config.yaml` uses `repo: local` hooks that run *the same command as CI*, and `js/tests/unit/pre-commit-config.test.js` fails if the two drift. A hook that runs something merely similar to CI is worse than none. |
| 9 | Release automation | **Was not met; fixed here** | OIDC trusted publishing and dual triggers were in place, and manual version bumps are blocked by `scripts/check-version-modification.mjs`. But "validated releases only" was not true in the direction that matters: the release *pushed* without being able to recover from a rejection, so a validated release could still fail to land — and did, for Python and Rust, at `67c003c`. See RC-1. |
| 10 | Concurrency control | Met in letter; **the gap this issue exposed** | Read-only jobs use per-job cancellable groups with matrix values in the key; every writer across all workflows shares `main-writer-${{ github.repository }}-main` with `cancel-in-progress: false`; `!cancelled()` is used rather than bare `always()`. All correct — and all insufficient, because serialising writers does not refresh their working trees. The principle as written does not say this, which is why it is being reported upstream (see `../templates/comparison.md` § Upstream). |
| 11 | Secrets detection | Met | `secrets-scan` job in `quality.yml` runs `secretlint` with the recommended rule preset over `**/*`. |
| 12 | Documentation validation | Met | `validate-docs` in `quality.yml`; `links.yml` runs `lychee` with a Web-Archive fallback before failing. |
| 13 | Container images: native runners per architecture | Not applicable | The repository publishes to npm, PyPI and crates.io; it has no `Dockerfile` and no image-building workflow. Recorded as N/A rather than "met" — a green tick here would be false. |
| 14 | Lint the workflows themselves | Met | `ci-policy.yml` runs `actionlint` **as the Docker image** (`docker://rhysd/actionlint:1.7.12`, so shellcheck and pyflakes are on PATH — the detail the principle singles out), `zizmor` with annotations rather than SARIF and `--min-confidence medium`, plus the repository's own `scripts/check-ci-workflows.mjs`. Suppressions are scoped in `.github/zizmor.yml`. |
| 15 | Audit the dependency tree | Met | `security.yml` runs `npm audit --package-lock-only --audit-level=high`, `cargo audit --file Cargo.lock`, and `python scripts/audit_dependencies.py`, **on a weekly schedule** as well as on push — the scheduled trigger being the only thing that can notice an advisory published after the code stopped changing. |

## What the audit found beyond the two marked rows

Nothing. Principles 1–8 and 11–15 were checked against the workflow files and
the 8 archived runs, not against memory, and each holds. This is a genuine
result rather than a formality: it is why the two failing workflows are
explained by one defect in the push path and not by a pipeline that was
generally under-built.

## One place where the best-practices document itself is incomplete

Principle 10 tells you to put every main-writer in one repository-scoped
concurrency group with `cancel-in-progress: false`. This repository did exactly
that, and two of its three release jobs still failed — because the guidance
stops one step short. A queued writer starts with the tree it was *triggered*
with, so serialisation guarantees ordering and nothing about freshness. The
missing sentence is roughly: *a serialised writer must still expect the branch
to have moved, so its push needs a rebase-and-retry with the rejection
classified first.*

That is a defect in shared guidance rather than in this repository, and it is
reported as such: **link-assistant/hive-mind#2220**. See also
`../templates/comparison.md` § Upstream.
