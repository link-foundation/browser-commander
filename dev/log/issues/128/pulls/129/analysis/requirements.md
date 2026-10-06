# Issue #128: requirements

Source: the issue title and body (`../github/issue.json`), and the task
statement for this pull request. The issue had no comments when the work
started (`../github/issue-comments.json` is `[]`).

| # | Requirement | Where it is met |
|---|---|---|
| R1 | Check every CI/CD signal on `main` for false positives, false negatives, warnings and errors. The issue lists the 11 runs on `b24e4c5`: three failed (Python, Rust, Safari), eight passed. | `signal-classification.md` classifies 27 signal groups across all 11 runs plus the latest scheduled parity run. Signals 28 to 38 in `root-causes-and-solutions.md` cover the open CodeQL alerts and what the PR's own runs exposed. |
| R2 | Fix them all. | `root-causes-and-solutions.md`, one row per signal and per template gap, each with its commit or the reason it needs no change. |
| R3 | Download all logs and related data into `dev/log/issues/128/pulls/129`. | `ci-logs/` (one log per run), `github/` (run metadata, check-run annotations, issue, PR, recent main runs) and `templates/` (template inventories and diffs). |
| R4 | Do a deep analysis, with online research. | `signal-classification.md`, `template-comparison.md` and `../research/web-sources.md`. |
| R5 | Reconstruct the timeline. | `timeline.md` |
| R6 | List every requirement. | This file. |
| R7 | Find the root cause of each problem and propose solutions. | `root-causes-and-solutions.md` |
| R8 | Check for existing components or libraries that solve similar problems. | `../research/web-sources.md`, section "Existing components". |
| R9 | Where the root cause is unknown, add debug output and a verbose mode, off by default. | `BUDGET_VERBOSE` (545cf48), `PIPELINE_STATUS_VERBOSE` (fa75f97), the Safari launch retry log under `VERBOSE` (7ac5cd3, 9faa67b, 03f27be) and the existing `CI_SCRIPTS_DEBUG`. All are off unless set. |
| R10 | Report upstream problems with a reproduction, a workaround and a suggested fix. | `../upstream/README.md` lists 6 reports. |
| R11 | Apply each fix everywhere it applies. | Each fix is pinned by a test that scans every workflow or script it applies to: `ci-workflow-policy`, `check-pipeline-status` ("workflows that run the gate"), `bot-commit-attribution`, `zizmor-version`, `ci-timeout-budgets`, `e2e-suite-coverage` and `links-workflow`. |
| R12 | Write a failing test before each fix. | `../reproductions/*-before.log` hold the failing runs; the matching tests live under `js/tests/unit/scripts/` and `python/tests/`. |
