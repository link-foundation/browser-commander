# Template and best-practice comparison

## Compared revisions

- JavaScript template: `f2cd4d8623557241fa4127a57a77461751a2f734`
- Python template: `03f3c8475dd9e59327422b3e0b9971772820f115`
- Rust template: `e7d4a5bceb152f76d9fde77bae6751b835b9cdcd`
- Hive-mind CI/CD guide: `ba12d5a329439d07c58d27ec978823a801f48282`

The `templates/` directory contains sorted full-tree comparisons, not a sample
of similarly named workflows. The workflow patches separately expose semantic
differences. The repository is a three-language monorepo, so template files
were evaluated as practices to reuse rather than copied wholesale.

## Practices already present and retained

- deterministic lockfile installs, manifest-aware version readers, bounded
  jobs, concurrency groups, and final pipeline-status gates;
- matrix testing on Linux, macOS, and Windows with legitimate platform skips;
- OIDC publishing, artifact digest validation, coverage gates, dependency
  audits, secrets scanning, docs/link checks, and release fragments;
- push-race recovery for multiple language release writers;
- explicit notices for optional services such as Codecov rather than silent
  success.

## Practices adopted or strengthened

- The current JS template already uses `actions/download-artifact@v8`; the
  Python workflow and repository policy now do too.
- Warning-fatal checks were extended from lint/clippy to Node deprecations and
  Rust documentation.
- CodeQL's supported no-build mode plus a repository config excludes archived
  source snapshots while retaining analysis of live JavaScript, Python, Rust,
  and workflow code.
- Node 22 replaces the EOL Node 20 compatibility floor; npm install scripts are
  reviewed with pinned approvals.

## Confirmed template defects

- Python template issue 85: its manual release path could pass a bump word to
  Scriv where a concrete version is required. The report includes reproduction,
  workaround, and proposed code/test changes.
- Python template issue 86: its release workflow retained
  `actions/download-artifact@v7` and can emit Node `DEP0005`; update to v8 and
  enforce it in template policy.

No matching staging or trace-resource defect exists in the generic JS
template; those are browser-commander implementation/test ownership issues. No
confirmed current Rust-template defect caused the repository's rustdoc or
CodeQL warnings. Historical case-study snapshots were intentionally excluded
from current-template conclusions.
