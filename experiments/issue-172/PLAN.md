# Issue 172 implementation checklist

Work only on `issue-172-a9f96de6a00d`; update existing PR 173.

- [x] Read parent issue 172 and both sub-issues, including all comments and PR comment types.
- [x] Verify branch and clean initial checkout; inspect repository guidance and release tooling.
- [x] Enumerate every requirement, alternatives, selected solution, and evidence in the investigation report.
- [x] Research primary documentation, upstream implementations/issues, and reusable libraries online.
- [x] Trace selector handling and startup/attachment/cleanup across JavaScript, Python, and Rust.
- [x] Reproduce selector mis-targeting with two containers before changing production code.
- [x] Reproduce deterministic launch readiness/attachment failure modes with finite mocked tests; distinguish these from the unconfirmed macOS symptom.
- [x] Fix selector identity in every affected engine/language and all callers, including DOM evaluation.
- [x] Fix evidenced startup/attachment issues without unconditional relaunch or larger default timeouts.
- [x] Add optional tracing where launch stages lack evidence; preserve sanitized failure diagnostics.
- [x] Verify failed launches terminate only their own child and remove only owned temporary profiles.
- [ ] Run focused unit tests, real-browser integration tests, then full relevant suites and local CI quality checks. Save large output in log files.
- [x] Keep experiments under this directory; bound stress probes and run memory-heavy builds sequentially with at most one compiler.
- [x] Add release fragments/triggers for packages changed, following repository conventions.
- [x] Commit independently useful steps after their local checks; push only the prepared branch.
- [x] Bring default-branch changes into the branch, preserving history.
- [x] Update PR title/body with reproduction, test evidence, limitations, all requirements and closing references for 170, 171, 172.
- [x] Review the complete PR diff for regressions and scope completeness.
- [x] List recent CI runs with timestamps and SHAs; download and inspect failed logs under `ci-logs/`; fix attributable failures.
- [ ] Wait for all background work and CI to finish; verify clean worktree and matching latest head.
- [ ] Mark PR 173 ready and report the PR URL with final validation and material limitations.
