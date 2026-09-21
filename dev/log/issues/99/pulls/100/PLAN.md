# Investigation and delivery plan

- [x] Verify the prepared branch, worktree, remote, and bootstrap commit.
- [x] Archive issue #99, PR #100, all three PR comment streams, events, the
  initial diff, and branch check metadata.
- [x] Download full logs and metadata for every default-branch run named by
  the issue, including successful runs needed to audit false positives and
  false negatives.
- [x] Capture authoritative check-run annotations and recent `main`/branch
  run lists with timestamps and SHAs.
- [x] Archive the current hive-mind best-practices document and current file
  trees/content from all three language pipeline templates.
- [x] Reconstruct the event timeline and enumerate every explicit and implied
  issue requirement.
- [x] Audit every error, warning, notice, skipped job, non-blocking command,
  and release gate in all archived runs and workflows.
- [x] Write minimal reproductions/tests for each confirmed defect before
  changing implementation code.
- [x] Fix every occurrence across the repository; add opt-in diagnostics if
  any root cause remains underdetermined.
- [x] Report confirmed template/upstream defects with reproduction,
  workaround, and proposed code fix.
- [x] Run focused tests, all language-local CI checks, workflow policy checks,
  and then the full local test suites.
- [x] Add release triggers required by repository conventions.
- [ ] Re-read the complete PR diff for regressions, merge current `main`,
  verify a clean worktree, commit atomically, and push only this issue branch.
- [ ] Replace the WIP PR title/body with evidence, reproduction, verification,
  and upstream links; inspect fresh CI by SHA and download every non-passing
  log before marking PR #100 ready.
