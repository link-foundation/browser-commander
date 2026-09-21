# Issue 99 / pull request 100 evidence index

This directory is the reproducible investigation record for
`link-foundation/browser-commander` issue 99 and pull request 100. Evidence was
captured on 2026-09-21 UTC. The issue's six reference runs all execute commit
`a15837d6a3bbf01f73b62b5c1e216c517dd51afd`.

## Contents

- `github/`: issue, pull request, every issue/PR comment stream, reviews,
  events, run metadata, check annotations, initial diff, and recent run lists.
- `ci-logs/`: complete logs for all six issue-listed runs plus the three older
  Python runs needed to reconstruct the release failure and every failed fresh
  pull-request validation run.
- `research/`: upstream releases/issues, PyPI responses, Node release data,
  signal extracts, template heads/file trees, upstream reports, and the exact
  hive-mind CI/CD guide used in the audit.
- `templates/`: complete repository/template file lists, workflow-relevant
  extracts, and file-by-file comparisons for JavaScript, Python, and Rust.
- `reproductions/`: before/after focused reproductions and full local check
  logs. Large command output was kept here instead of pasted into analysis.
- `analysis/`: requirement inventory, timeline, root causes and alternatives,
  signal classification, template comparison, and authoritative web sources.
- `PLAN.md`: execution checklist.

## Primary findings

The two reported failures were independent: a JavaScript download-staging race
on macOS, and a non-idempotent Python release retry after PyPI rejected the
initial upload. Successful workflows also hid actionable warnings: leaked
Node file handles, a deprecated native dependency, broken rustdoc links,
CodeQL extraction gaps, an obsolete artifact action, and a noisy mypy helper
pass. All are addressed in PR 100 except the PyPI Trusted Publisher account
setting, which requires a maintainer and is deliberately reported as a hard,
actionable release failure.

See `analysis/root-causes-and-solutions.md` for the complete result,
`analysis/signal-classification.md` for the line-by-line signal disposition,
and `analysis/final-validation.md` for findings from fresh PR validation.
