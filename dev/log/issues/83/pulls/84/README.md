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

| Run | Workflow | Conclusion reported by GitHub |
| --- | --- | --- |
| 33974450000 | Python CI/CD Pipeline | failure |
| 33974450013 | Documentation | success |
| 33974450016 | JavaScript CI/CD Pipeline | success |
| 33974450017 | Link Checker | success |
| 33974450018 | CI Policy | success |
| 33974450021 | Security | success |
| 33974450025 | Quality | success |
| 33974450069 | Rust CI/CD Pipeline | success |

`analysis/root-causes.md` explains why several of the "success" rows are false
negatives.

## Reproductions

The scripts that reproduce the defects found here live outside this directory,
in `experiments/ci-repro/`, so that they stay runnable rather than archived.
