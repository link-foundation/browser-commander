# Root causes, alternatives, and selected solutions

## 1. JavaScript macOS staged-download race

Root cause: `waitForStagedFile` treated two equal-size polls as completion. A
writer can pause longer than one 25 ms poll, so the function returned after the
first byte and the test observed 1 instead of 2. macOS timing exposed a real
algorithmic race rather than an OS-specific assertion problem.

Possible solutions included increasing one timeout, watching filesystem events,
waiting for a browser rename, or requiring a monotonic quiet period. Increasing
the timeout does not change the invalid completion predicate, and filesystem
events are lossy/platform-specific. The selected solution requires an
unchanged-size quiet period (100 ms by default, configurable) while continuing
to reject partial-file siblings. The paused-writer regression fails the old
two-poll implementation.

## 2. Node `DEP0137` file descriptor leaks

Root cause: trace-bundle tests opened `events.jsonl` handles without finalizing
or aborting them. An invalid links option also opened the authoritative bundle
before validating the side export, so rejected startup could not return a
resource for callers to close. Garbage collection masked these leaks.

The opt-in tracer recorded allocation stacks for every `fs/promises.open` and
identified four final allocations in recorder/viewer interruption tests. The
selected solution adds an idempotent `abort()` boundary, validates links before
opening a bundle, centralizes fixture cleanup, and explicitly stops traces in
tests that simulate interruption. The test runner now uses
`--throw-deprecation`, converting future deprecation regressions into failures.
The full 1,137-test run and a tracer-enabled run report no leak.

## 3. Deprecated `prebuild-install` and npm 12 script warnings

Root cause: `better-sqlite3@12.11.1` depended on unmaintained
`prebuild-install@7.1.3`; it appeared in JS, docs, and quality installs. Staying
on it also retained an EOL Node 20 floor. better-sqlite3 13 moved to N-API,
ships prebuilds directly, removes `prebuild-install`, and requires Node 22.

The dependency was upgraded to 13.0.3 and the engine floor to 22. npm 12 then
correctly asked for install-script decisions. A pinned approval is recorded for
better-sqlite3 and Puppeteer's browser download is explicitly denied, leaving
no unreviewed install scripts and no install warning. Alternatives—ignoring
scripts globally or suppressing npm warnings—would hide dependency behavior.

## 4. Non-idempotent Python publish retry

Root cause: the release transaction commits changelog collection before PyPI
publishing. When publishing failed and no tag was created, the next run retried
the same version and unconditionally called Scriv. Scriv correctly refuses a
duplicate version heading, so later fragments could neither publish nor remain
quietly queued.

The collector now detects an existing level-two heading for the requested
version, leaves all newer fragments for the next version, and continues the
old artifact's publish retry. A unit test asserts Scriv is not invoked and the
fragment survives. Moving changelog commit after publishing was rejected: it
would make published release notes unavailable to the same job and worsen
concurrent-writer behavior.

## 5. PyPI `invalid-publisher`

Root cause: PyPI has no project/pending publisher matching owner
`link-foundation`, repository `browser-commander`, workflow `python.yml`, and no
environment. The package JSON endpoint returned 404 and the action printed the
exact missing-publisher diagnosis. This is an account-side prerequisite, not a
code bug.

The code must keep failing loudly; falling back to a long-lived API token or
marking publish non-blocking would be a security/observability regression. A
maintainer must register the pending Trusted Publisher with those exact claims,
then rerun the failed release. PR 100 records this external action explicitly.

## 6. Rust documentation false negative

Root cause: three intra-doc links were resolved from the wrong module scope,
and the docs workflow allowed rustdoc warnings. Thus a successful workflow
published documentation containing unresolved references.

Links now use fully qualified crate paths and the workflow exports
`RUSTDOCFLAGS=-D warnings`. Escaping the link syntax would remove navigation;
keeping warning-only behavior would retain the false negative.

## 7. CodeQL Rust extraction warnings

Root cause A: immutable issue-55 template snapshots contain standalone Rust
scripts with no Cargo manifest. They are evidence, not shipped code. Root cause
B: platform-gated `assert!` calls in a live test produced two macro-expansion
failures for the extractor.

The platform test now computes one platform predicate and invokes one common
assertion. A CodeQL configuration excludes archival snapshots. CodeQL uses the
official `none` build mode so `paths-ignore` also applies to Rust; retaining
autobuild would make the apparent exclusion ineffective for a compiled
language. Deleting the evidence or inventing a fake Cargo project was rejected.

## 8. Artifact action `DEP0005`

Root cause: the Python workflow retained `actions/download-artifact@v7`, whose
runtime emitted deprecated `Buffer()` usage during the real release. The
current upstream action is v8.0.1.

The workflow now uses v8 and repository policy rejects v1-v7. A focused policy
test locks that behavior. The same template defect is reported as upstream
issue 86.

## 9. mypy unused-config note

Root cause: the second mypy invocation checks only CI scripts while inheriting
Playwright/Selenium module overrides intended for the primary `src` pass.

Only the narrow scripts pass gets `--no-warn-unused-configs`; the main pass
retains unused-configuration detection. Removing the overrides or disabling
the check globally would reduce useful type-checking coverage.

## 10. Preventive controls

The fixes favor enforceable controls over log filtering: deprecations throw in
JS tests, rustdoc warnings fail, obsolete artifact actions fail policy, npm
install scripts are explicitly reviewed, and release retries have a direct
unit test. The descriptor tracer remains default-off for future investigations
without changing production behavior.
