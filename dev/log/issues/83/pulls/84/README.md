# Evidence for issue #83 / pull request #84

Everything under this directory is raw material collected while investigating
[issue #83](https://github.com/link-foundation/browser-commander/issues/83),
"Check for all false positives, false negatives, warnings and errors in CI/CD
and fix them all". It is committed on purpose so that the reasoning in the pull
request can be re-checked against the logs it was drawn from, the same way
`dev/log/issues/81/pulls/82/` records the previous iteration.

| Directory | Contents |
| --- | --- |
| `issue/` | Issue #83 body and comments, as returned by the GitHub API |
| `pr/` | Pull request #84 metadata, conversation comments, review comments, reviews |
| `ci-logs/` | Full job logs and run metadata for every workflow run on the commit named in the issue |
| `workflows/` | Snapshot of the nine workflow files as they were before this pull request |
| `templates/` | File-tree comparison against the three pipeline templates, and the upstream reports filed |
| `best-practices/` | Archive of the referenced CI/CD best-practices document and a per-principle audit |
| `analysis/` | Timeline, requirement matrix, root causes, survey of existing solutions |

## Runs covered

The issue lists eight runs at commit `4f7af54`. All eight are archived here as
`ci-logs/run-<id>.log` (job logs, ANSI escapes stripped) and
`ci-logs/run-<id>.json` (run and job metadata).

| Run | Workflow | Conclusion reported by GitHub | Truthful? |
| --- | --- | --- | --- |
| 33974450000 | Python CI/CD Pipeline | failure | yes — RC-A |
| 33974450013 | Documentation | success | yes |
| 33974450016 | JS CI/CD Pipeline | success | **no** — RC-G |
| 33974450017 | Repository Quality Gates | success | yes |
| 33974450018 | Broken Link Checker | success | yes |
| 33974450021 | Security | success | yes — `dependency-review` skipped is correct on a push |
| 33974450025 | CI Workflow Policy | success | yes |
| 33974450069 | Rust CI/CD Pipeline | success | **no** — RC-C |

Workflow names are as reported by the API in `ci-logs/run-list-main.json`; all
eight runs were queued at `2026-09-05T15:19:32Z` for the same push.

## Analysis

| File | Contents |
| --- | --- |
| `analysis/timeline.md` | What happened, in order, inside the push and across the longer arc |
| `analysis/requirements.md` | Every requirement from the issue and the task, with status and the implementation plan |
| `analysis/root-causes.md` | One section per defect, classified as error / false negative / false positive / warning, with quoted log evidence and a fix |
| `analysis/existing-solutions.md` | Survey of libraries that solve each root cause, and why each was or was not adopted |
| `analysis/changesets-format-detect-evidence.md` | Source-level evidence for RC-G, read out of a freshly installed `@changesets/format` |

## Reproductions

The scripts that reproduce the defects found here live outside this directory,
in `experiments/ci-repro/`, so that they stay runnable rather than archived.
