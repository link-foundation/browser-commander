# Issue #128 / PR #129: CI/CD false positives, false negatives, warnings and errors

Issue: <https://github.com/link-foundation/browser-commander/issues/128>.
Pull request: <https://github.com/link-foundation/browser-commander/pull/129>.

The issue asks for every signal in the 11 CI runs on `main` @ `b24e4c5` to be
checked, and for all of them to be fixed. Three runs failed (Python, Rust,
Safari). The eight green runs carried false negatives (suites and tests that
never ran), warnings and noise.

## Contents

| Path | What it holds |
|---|---|
| `analysis/requirements.md` | Every requirement and where it is met |
| `analysis/timeline.md` | The sequence of events |
| `analysis/signal-classification.md` | 27 signal groups from the logs, each classified with log line references, plus signals 28 to 39 (CodeQL alerts and failures found on the PR) |
| `analysis/template-comparison.md` | Gaps against the link-foundation pipeline templates |
| `analysis/root-causes-and-solutions.md` | Root cause, fix, commit and guarding test for every signal and gap; what remains for maintainers |
| `research/web-sources.md` | Online sources checked, and existing components considered |
| `upstream/` | The bodies of the six upstream issues filed, and an index |
| `reproductions/` | Before and after output for each fix |
| `ci-logs/` | Logs of the 11 runs on `main`, the scheduled parity run, a Windows Rust history log, and the failed PR runs |
| `github/` | Run metadata, check-run annotations, the issue and the PR as JSON |
| `templates/` | Template file inventories and diffs of shared scripts |

## Outcome in short

- **Fixed in code:** every signal and template gap that needed a change in this repository. Each has a test or check that fails if the problem returns.
- **Maintainer actions:**
  - register the PyPI trusted publisher;
  - add `CODECOV_TOKEN`;
  - optionally enable GitHub Pages with `DEPLOY_GITHUB_PAGES=true`.
- **Upstream:** command-stream#213, rust template #185 and #186, python template #95, js template #209 and #210.
