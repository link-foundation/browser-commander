# Issue 189 implementation and verification plan

Objective: implement all scoped saved-login refresh requirements in PR #190 on
`issue-189-73b0dec0b70f`, without merging the pull request.

## Requirements and work checklist

- [x] Read complete issue #189, its comments, and all three PR #190 feedback feeds.
  No required sub-issues or feedback are currently present. #114 and consumer #72
  supply context, rather than adding their independent feature scope to #189.
- [x] Inspect repository guidance, migration writers, crypto, snapshots, schemas,
  domain matching, launch ordering, CLI reports, existing tests and release rules.
- [x] Reproduce destructive scoped refresh with automated fixtures before fixing.
- [x] Preserve unrelated and target-only selected-domain credentials; document a
  deterministic identity/conflict policy and prove repeat refresh idempotence.
- [x] Preserve compatible target schema/metadata, handle account stores explicitly,
  and keep source profiles read-only. Refuse unsafe schemas before target writes.
- [x] Require closed target for every file-level password writer, with actionable
  guidance; preserve target bytes on active/unsupported failures.
- [x] Use target encryption/keystore and scrub routine reports of passwords, keys,
  cookie values and usernames. Keep domain matching/reporting in JS/Rust/Python/CLI
  consistent. Keep clone/replace semantics separate if retained.
- [x] Exercise minimal unit fixtures first, then existing integration/full suites;
  save large command output as logs and bound memory-heavy Rust builds to one job.
- [x] Document supported schemas, metadata, account stores, safe refusal guidance,
  reproducible tests and acceptance evidence. Prepare required release triggers.
- [ ] Run local CI checks before atomic commits; preserve history and push only
  the prepared branch. Merge latest default branch if needed.
- [ ] Review final PR diff and feedback, update PR title/body (Fixes #189), remove
  placeholder .gitkeep, mark PR ready, ensure clean tree and passing current-SHA CI.
- [ ] For failing CI: list timestamp/SHA, download logs into ci-logs/, read errors,
  fix actual root causes and verify on a fresh run. Never report stale CI as current.

No UI changes are expected. Debug/experiment scripts belong in experiments/issue-189.

## Evidence

- Shared regression: `tests/fixtures/password-refresh.sql` and password-refresh
  tests in JS/Python/Rust. The JS test failed before implementation (`2 !== 1`).
- Live Chromium basic-keystore acceptance: `verify-chromium.mjs` passes active
  refusal, merge, idempotence, browser reopen and database integrity.
- Python full default suite: 1,403 passed, 32 opt-in browser tests skipped.
- Full Rust build stopped before OOM at 2.92 GiB; actual password modules and
  their regression tests pass in the focused harness. Full CI remains required.
- CLI privacy regression failed before the summary filter; shared CLI test passes.
