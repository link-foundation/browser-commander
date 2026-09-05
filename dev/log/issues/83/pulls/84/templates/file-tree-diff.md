# Template file-tree comparison, second pass

Issue #83 repeats the instruction issue #81 gave: _"Use all the best practices from
CI/CD templates (check full file tree to compare for all GitHub workflow and CI/CD
scripts file), if the same issue is found in template report issue also in templates"_
and _"We should compare all files, so we don't have more CI/CD errors in the future and
reuse all the best practices from these templates."_

The full comparison, with a decision recorded for every CI/CD-relevant path the
templates have and this repository does not, is
[`../../../81/pulls/82/templates/file-tree-diff.md`](../../../81/pulls/82/templates/file-tree-diff.md).
It is not repeated here. This file records the two things that pass could not:

1. what moved between the two passes, and
2. which of its decisions issue #83 proves were **wrong**, because the defect they
   waved away is the one that made three release jobs lie.

| Tree                                                           | Revision          | Committed                 |
| -------------------------------------------------------------- | ----------------- | ------------------------- |
| browser-commander (this repository)                            | this pull request | —                         |
| link-foundation/js-ai-driven-development-pipeline-template     | `338fafa`         | 2026-09-05 09:54:55 +0000 |
| link-foundation/python-ai-driven-development-pipeline-template | `81c9786`         | 2026-09-04 02:55:52 +0700 |
| link-foundation/rust-ai-driven-development-pipeline-template   | `4d444d9`         | 2026-09-05 09:52:40 +0000 |

All three templates are at the same heads issue #81's second revision measured, so every
number below moved because _this_ repository moved.

## What moved

Same rule as before — a template path `p` counts as present when this repository has `p`
or `<language>/p` — recomputed with `git ls-files` on both sides:

| Template | Paths upstream | Absent here | Of those, CI/CD-relevant | Absent at #82 |
| -------- | -------------: | ----------: | -----------------------: | ------------: |
| js       |            377 |         332 |                       35 |           334 |
| python   |             83 |          63 |                       16 |            65 |
| rust     |            149 |         127 |                       34 |           129 |

Closed since #82, by the follow-up commits that pull request promised:

| Path                                 | Template(s)      |
| ------------------------------------ | ---------------- |
| `scripts/run-with-budget-warning.sh` | js, python, rust |
| `scripts/check-pipeline-status.sh`   | js, python, rust |
| `docs/CI-TIMEOUT-BUDGETS.md`         | js               |

Newly absent since #82 — one path, and it is deliberate:

| Path        | Template | Why this repository dropped it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deno.json` | js       | RC-G. `@changesets/cli` v3 formats the changelog it writes, and `@changesets/format`'s `detect()` picks the **deno** formatter on the mere existence of a `deno.json`, ahead of the prettier this package actually installs. `deno` is the one formatter in that table with no `packageName`: it is spawned straight off `PATH`, so on a runner without Deno `changeset version` dies with `spawn deno ENOENT` _after_ bumping the version and writing `CHANGELOG.md` and _before_ deleting the changeset it consumed. `js/deno.json` here was orphaned — no workflow, no npm script and no document referenced it — so deleting it is the honest fix. See [`upstream-reports/`](upstream-reports/) |

## Decisions from #82 that issue #83 revises

Both revisions point the same way: #82 read a template path, found something in this
repository that _looked_ equivalent, and stopped. In each case the template path solves a
problem the local equivalent does not, and the gap between them is a root cause in
[`../analysis/root-causes.md`](../analysis/root-causes.md).

### js `scripts/run-command.mjs` — reopened, closed differently

> #82: _"`scripts/bootstrap-dependencies.mjs`, `scripts/run-command.mjs` (js) — both
> exist to make the templates' seven use-m-loading release scripts fail loudly; this
> repository loads use-m in one place, `scripts/use-module.mjs`, which already bounds
> and reports the load."_

`use-module.mjs` bounded the **load**. `run-command.mjs` bounds the **exit code**, which
is a different failure and the one that mattered. Its own header says so:

> Unlike command-stream's `$`, `runStrict` throws on a non-zero exit code, restoring
> `set -e` semantics.

`command-stream` resolves rather than rejects when a command exits non-zero, so every

```js
try {
  await $`some-command`;
} catch {
  process.exit(1);
}
```

in this repository's thirteen release scripts was dead code (RC-B), and that is why a
crashed `changeset version` was reported as a successful JS release (RC-G) and a Rust
release that never committed its version bump published to crates.io anyway (RC-C).

This pull request closes the gap at the choke point instead of adopting a second
wrapper: `loadCommandStream()` calls `shell.errexit(true)`, so the `$` every script
already imports acquires the semantics all thirteen were written against. A `runStrict`
alongside the permissive `$` would have left the permissive one importable, and thirteen
call sites to remember to migrate. Guarded by
`js/tests/unit/scripts/command-stream-errexit.test.js` and
`use-module-adoption.test.js`.

**The template still has the defect**, because it ships `runStrict` and does not use it
in its release scripts. Reported upstream — see
[`upstream-reports/js-command-stream-dead-catch.md`](upstream-reports/js-command-stream-dead-catch.md).

### rust `scripts/test-scripts.sh` — reopened, closed differently

> #82: _"`scripts/install-rust-script.sh`, `scripts/test-scripts.sh` (rust) — not
> needed: the rust helpers here are `.mjs`, covered by `repo-scripts-lint` and by the js
> unit tests."_

`repo-scripts-lint` runs ESLint, which parses; it does not execute. And at #82 the js
unit tests covered `scripts/` and `js/scripts/` but nothing under `rust/scripts/` — the
release half of the pipeline was the untested half, in every language. That absence is
the systemic reason RC-B, RC-C, RC-D, RC-G and RC-H all shipped green: none of them is
subtle, and any one execution of the code would have caught them.

The template runs its script tests as a dedicated `script-tests` job invoking
`bash scripts/test-scripts.sh`. This repository closes the same gap through the test
suite it already has, so the guard runs on every pull request rather than in a job of
its own:

| Guard                                                      | Covers                                                                                                                            |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `js/tests/unit/scripts/command-stream-errexit.test.js`     | RC-B — a failing command rejects                                                                                                  |
| `js/tests/unit/scripts/command-error-text.test.js`         | RC-B — the "already published" branches read `stderr`, not `message`                                                              |
| `js/tests/unit/scripts/rust-changelog.test.js`             | RC-C — the bump is committed, the fragments are consumed                                                                          |
| `js/tests/unit/scripts/cargo-lock-sync.test.js`            | RC-C — `Cargo.lock` tracks the bumped `Cargo.toml` (this is the template's `check-cargo-lock.rs`, as a test rather than a script) |
| `js/tests/unit/scripts/release-tags.test.js`               | RC-D — the three languages do not share a tag namespace                                                                           |
| `js/tests/unit/scripts/changeset-formatter.test.js`        | RC-G — the pinned formatter is one this package can run                                                                           |
| `js/tests/unit/scripts/changelog-collection-order.test.js` | the changelog is collected under the version being released                                                                       |
| `js/tests/unit/scripts/check-release-format.test.js`       | RC-E — the release commit is validated before it is pushed                                                                        |
| `python/tests/unit/scripts/test_explain_pypi_failure.py`   | RC-A — the PyPI failure names the missing registration                                                                            |

### rust `scripts/check-cargo-lock.rs` — adopted, as a test

> #82: listed under "not applicable", grouped with the changelog-fragment scripts.

`check-cargo-lock.rs` is not about changelog fragments; it checks that `Cargo.lock`
agrees with `Cargo.toml`. That was unreachable here only because RC-C meant the bump was
never committed, so `main` always held a matching pair. Fixing RC-C makes the drift
reachable, so the guard is now real: `cargo-lock-sync.test.js`, plus the
`cargo update -p <crate>` step in `rust/scripts/version-and-commit.mjs`.

## Decisions from #82 that stand

Re-checked against this issue's findings, unchanged:

- `.github/workflows/release.yml` and `workflows.yml` — covered by the per-language
  workflows and by `ci-policy.yml`.
- The Docker, desktop and example-app paths — nothing here to apply them to.
- `scripts/smoke-test-package.mjs`, `wait-for-npm.mjs`, `smoke_test_published_package.py`,
  `smoke-test-published-crate.rs`, `wait-for-crate.rs` — still a real gap, still
  unexercisable before a merge. RC-A is the reminder of why that matters: the Python
  release has never once succeeded, and no smoke test would have caught it, because the
  failure is upstream of publishing.
- `scripts/land-via-pull-request.mjs`, `push-main-with-rebase-retry.mjs`,
  `push-failure-classifier.mjs` — a lost push race fails loudly; out of scope for an
  issue about checks that fail _quietly_.
- `scripts/lint-changed-lines.mjs`, `lint.mjs` — narrowing what a run reports is the
  opposite direction from "find every warning".

## Defects found here, checked against each template

The point of the comparison the issue asks for. Every root cause in
[`../analysis/root-causes.md`](../analysis/root-causes.md), tested against the template
it came from:

| Root cause                                                       | js template                                                                                                                                                                                             | python template                                                                                                                                                  | rust template                                                                                                                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RC-A — PyPI publisher never registered                           | n/a                                                                                                                                                                                                     | not reproducible from source: the registration is per-repository. The template's `publish_to_pypi.py` has the same shape                                         | n/a                                                                                                                                                                                 |
| RC-B — `$` never rejects, so every `try`/`catch` is dead         | **present** — reported                                                                                                                                                                                  | n/a (Python scripts read real exit codes)                                                                                                                        | not present — the `.rs` scripts read real exit codes                                                                                                                                |
| RC-C — version bump never committed                              | not present                                                                                                                                                                                             | not present                                                                                                                                                      | **not present** — `version-and-commit.rs:855` uses `if exec_check(...)` on the real exit code. RC-C is a porting defect introduced when these scripts were rewritten as `.mjs` here |
| RC-D — tag namespaces collide                                    | n/a (single language)                                                                                                                                                                                   | n/a                                                                                                                                                              | n/a — the template uses `tag_prefix` already                                                                                                                                        |
| RC-E — the release commit is never validated before it is pushed | **present, latent**                                                                                                                                                                                     | not present — `auto-release` publishes a version bump that arrived through an ordinary pull request, so the commit went through `lint` and `test` like any other | **present, latent** — `auto-release` writes `Cargo.toml`, `Cargo.lock` and `CHANGELOG.md`, commits and pushes; the format check lives in `lint`, which saw only the parent          |
| RC-G — `changeset version` dies on a missing `deno`              | **present, latent** — ships `deno.json` and `deno.lock`, but pins `@changesets/cli: ^2.29.7`, which predates the v3 formatter. It breaks on the next major upgrade. Already reported upstream as js#154 | n/a                                                                                                                                                              | n/a                                                                                                                                                                                 |
| RC-H — `findNextAvailableVersion` gives up after 20 probes       | n/a                                                                                                                                                                                                     | n/a                                                                                                                                                              | not present                                                                                                                                                                         |

RC-E is latent rather than live in the js and rust templates for the same reason it was
latent here until it fired: it needs a release to actually write something a format check
would reject. Reported against both —
[`upstream-reports/release-commit-never-validated.md`](upstream-reports/release-commit-never-validated.md).

## The raw lists

Unchanged from #82 apart from the five paths tabulated above, so they are not duplicated
here. To regenerate:

```sh
python3 - <<'PY'
import subprocess
tracked = lambda d: set(
    l for l in subprocess.run(
        ['git', '-C', d, 'ls-files'], capture_output=True, text=True
    ).stdout.splitlines() if l
)
ours = tracked('.')
for lang, path in [('js', ...), ('python', ...), ('rust', ...)]:
    upstream = tracked(path)
    absent = [p for p in sorted(upstream)
              if p not in ours and f'{lang}/{p}' not in ours]
    print(lang, len(upstream), len(absent))
    print('\n'.join(absent))
PY
```
