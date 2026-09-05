# Timeline: how the three pipelines went red

Reconstructed from `../ci-logs/run-list-main.json` (97 runs on `main`), the
downloaded job logs in `../ci-logs/`, `git log`, and the npm registry metadata
for `command-stream`. Every row is checkable with a command named in the notes.

| When (UTC) | What happened | Evidence |
| --- | --- | --- |
| 2025-12-28 | Single "Checks and release" workflow, 5 runs, all green | `run-list-main.json` |
| 2026-01-01 | Split into `JS CI/CD Pipeline` and `Rust CI/CD Pipeline` | `run-list-main.json` |
| 2026-01-13 | `b4ad566` adds `python/` with the Python pipeline **and** `[tool.scriv] version = "literal: pyproject.toml: project.version"` in the same commit | `git log -S` on `python/pyproject.toml` |
| 2026-01-13 → 2026-08-02 | 11 green Python runs. None of them reaches the release path, so the duplicate `version =` key stays latent; `python/pyproject.toml` is never bumped by CI | `git log -- python/pyproject.toml` shows no `chore(release)` commit |
| 2026-06-28 | `cbd4fe1` moves the workflows to `node-version: '24.x'` | `git log -S "node-version: '24.x'"` |
| 2026-08-02 07:55 | Run `30738733161` — last green Python run | `run-list-main.json` |
| **2026-08-02 14:38** | Run `30752540589` — **first Python failure**: `Invalid format 'literal: pyproject.toml: project.version'`. The release path executes for the first time since the scriv key was added | `failed-30752540589-python-2026-08-02.log` |
| 2026-08-02 14:38 | Run `30752540657` — last green JS run (release job included) | `run-list-main.json` |
| 2026-08-11 04:07 | Run `31457494585` — last green Rust run | `run-list-main.json` |
| **2026-08-11 11:28** | `command-stream@0.19.0` published. Its `require` entry moves from `./src/$.mjs` to `./src/$.cjs` — 7 h 21 min after the last green Rust run | `inspect-command-stream-entries.mjs`, `raw-repro-evidence.txt` §2 |
| 2026-09-04 21:16 | `97b9896` (merge of PR #80) triggers all seven workflows. Python `33920348247`, JS `33920348338` and Rust `33920348349` fail | the three `failed-*.log` files |
| 2026-09-05 09:19 | Issue #81 filed | `../issue/issue-81.json` |

## Why the two failure classes look unrelated but are not

Both are the same category of defect: **a release-critical value is read from a
source that nobody pinned, and nothing in CI exercised the read until the
release path ran.**

* Python read a version out of a TOML file with a line-oriented `grep`. The file
  gained a second `version =` key under a different table, and the read started
  returning two lines. `$GITHUB_OUTPUT` rejects multi-line values, so the step
  died with `Unable to process file command 'output' successfully`.
* JS and Rust read `$` out of whatever `use('command-stream')` returns, with no
  version specifier. Upstream changed the package's `require` entry from ESM to
  CommonJS, the namespace shape changed, and `const { $ } = ...` started
  yielding `undefined`.

In both cases the failing code path only ever ran on `main`, inside a job that
tags and publishes. That is why nothing caught either one on a pull request.

## The gap that let it sit for a month

`main` was red for 33 days (2026-08-02 → 2026-09-04) before anyone noticed,
because a failing *release* job on `main` produces no signal on anybody's pull
request. The three fixes for the failures themselves are in the first commits of
this branch; the checks that would have caught them earlier — the CI policy
rules, `actionlint`, `zizmor`, the duplication gate that actually reads code,
and the dependency audits — are the rest of it.
