# PR #111 CI investigation, 2026-09-30

The failing runs were checked against their creation times and head commit.
The initial failures below belong to `819a3cd`; the fresh security failure
belongs to `44b2c55`, the commit that fixed the initial failures. Full downloaded
logs are preserved locally in `ci-logs/`. The changeset failure below belongs
to the native snapshot commit, `aeceb45`.

| Run                                                                                                        | Error and evidence                                                                                                                                                                                                                   | Resolution                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Documentation 36623403770](https://github.com/link-foundation/browser-commander/actions/runs/36623403770) | `documentation-36623403770.log`, lines 907–925: rustdoc rejects the redundant explicit `EngineAdapter` link target with warnings denied. A local `cargo doc` reproduced this error.                                                  | Removed the redundant link target; `RUSTDOCFLAGS='-D warnings' cargo doc --no-deps --all-features` passes.                                                                |
| [JavaScript 36623404027](https://github.com/link-foundation/browser-commander/actions/runs/36623404027)    | `js-36623404027.log`, lines 4335–4386: the CI budget test rejects the CLI job's 2,100-second total: a 40-minute job permits only 1,680 budgeted seconds. Its expected-budget inventory also omitted the new Rust storage-state step. | Moved the storage test into its own job and updated the inventory. The budget test's eight assertions pass; the CLI job now has 1,500 budgeted seconds.                   |
| [Security 36710121025](https://github.com/link-foundation/browser-commander/actions/runs/36710121025)      | `security-36710121025.log`, lines 2421–2433: locked `brace-expansion` 5.0.9 has three high-severity CPU/stack-exhaustion advisories and `npm audit` exits 1.                                                                         | Updated only that locked dependency to 5.0.12. `npm audit --package-lock-only --audit-level=high` reports zero vulnerabilities; JavaScript tests and quality checks pass. |
| [JavaScript 36714030272](https://github.com/link-foundation/browser-commander/actions/runs/36714030272)    | `js-36714030272.log`, lines 1851–1861: the security update added a second JavaScript changeset, but the release gate requires exactly one per PR. The local validator reproduced the failure.                                        | Combined both release notes in the existing patch changeset. The changeset validator and JavaScript quality checks pass.                                                  |

The relay commit `4604cc8` passed 55 checks and eight expected skips, but a fresh
[JavaScript run 36724595087](https://github.com/link-foundation/browser-commander/actions/runs/36724595087)
failed on Windows. `js-36724595087.log`, lines 4423–4434, reports `EPERM` from
the credential cache's exclusive lock open in the three-process coordination
test. Windows can report this while the previous lock is pending deletion.
The new mocked regression fails with that same error before the fix. Windows
`EPERM` now follows the existing bounded contention retry; Unix `EPERM` and
`EACCES` still fail immediately. A persistent Windows error is retained as the
timeout's cause. The existing three-process integration test remains enabled.

The six initial non-passing checks included dependent pipeline-status failures
and repeated platform jobs. They did not represent six independent defects.
Fresh checks on `44b2c55` passed the original documentation and JavaScript gates;
the npm audit and its dependent security gate then failed on the newer advisory.

Native snapshot work also produced three local regressions with tests written
before their fixes:

- Python's online backup retried `SQLITE_BUSY` until a test released an exclusive
  lock after four seconds. The test requires a snapshot in under three seconds.
  Bounded busy retries now use the existing file-and-sidecar fallback.
- Rust's default SQLite busy handler likewise waited 4.21 seconds for the
  four-second test lock. A read-only connection with an immediate busy return
  now takes the existing fallback. The real three-engine snapshot test dropped
  from 237.20 seconds to 9.03 seconds.
- A corrupt SQLite file left a failed partial database in Python's copy.
  The reproducing test asserts exclusion of that file, an `unreadable` report
  entry and unchanged source bytes. Failed partial copies are now removed.

The lock probes always release their locks after four seconds. Python tests
also cover cancellation while copying and cleanup after connection failure.
Real Chrome snapshot tests in Python and Rust keep the source browser open,
verify the selected Profile 1, close each copied browser and verify that only
its temporary directory was removed. CI runs these launches in a separate job
with explicit execution budgets.

The native Rust parity probe found another reproducible bridge regression:
`compactObject` removed Puppeteer's explicit `defaultViewport: null` during
attachment. Puppeteer's default viewport emulation then changed
`screen.orientationType` from the reference's `landscape-primary` to
`portrait-primary`. The browser test failed on that specific difference
(`ci-logs/rust-puppeteer-viewport-before.log`). Preserving the null outside
option compaction disables the unintended emulation. The same test covers
all three CDP engines, a webdriver negative control and borrowed-session
ownership; it keeps any unexplained probe differences in the report.

The WebDriver commit `59fe132` produced two new failures in fresh runs:

- [Rust 36734626882](https://github.com/link-foundation/browser-commander/actions/runs/36734626882):
  `rust-36734626882.log`, lines 3260–3269 and 4088–4097, rejects an unused
  `pid` in the Windows and macOS test builds with warnings denied. Only the
  Linux cleanup assertion used it. The test now asserts a valid process ID
  on every platform before its Linux-specific process cleanup check.
- [Parity 36734626877](https://github.com/link-foundation/browser-commander/actions/runs/36734626877):
  `parity-36734626877.log`, lines 2994–2995, reports a missing environment
  variable in the native WebDriver integration test. The resolver had run in
  the storage-state job instead of the snapshot job that consumes its output.
  It now runs in the consuming job. A workflow regression assertion requires
  every job running the native WebDriver tests to resolve its drivers first.

The native trace work ended with three more findings, each reproduced first:

- [Python 36899766114](https://github.com/link-foundation/browser-commander/actions/runs/36899766114)
  on `ebdbb21`: `py-win-110496178516.log`, lines 596–597, shows the Windows
  conformance test receiving `\r\n` where the JavaScript recording has `\n`.
  Trace files were opened in text mode. They are now opened in binary mode,
  and `test_opens_every_member_in_binary_mode` covers every bundle member.
- CodeQL raised `js/xss-through-dom` in the generated viewer fixture. Recorded
  URL, title, control values and event fields reached the viewer's markup
  unescaped, so a hostile page title ran script in the viewer. `f3156c4`
  escapes them; the viewer test that drives the script failed before it.
  [JavaScript 36905406078](https://github.com/link-foundation/browser-commander/actions/runs/36905406078)
  then failed (`js-changeset-36905406078.log`, line 24: two changesets), so
  the note joined the existing changeset, and the test stopped extracting the
  script with a regular expression that CodeQL flagged as `js/bad-tag-filter`.
- The remaining `js/xss-through-dom` alert (#55) is the viewer's mutation
  replay, which parses recorded HTML with `DOMParser` by design. That
  document is inert and its serialization only becomes the `srcdoc` of the
  stage frame, which is sandboxed without `allow-scripts`.
  [`viewer-replay-inert.mjs`](../experiments/issue-110/viewer-replay-inert.mjs)
  records hostile markup in the snapshot, title, URL and a replayed mutation
  and opens the viewer in Chrome: before `f3156c4` the URL and title ran,
  afterwards nothing runs. The alert was dismissed as a false positive with
  that evidence.

The PyPI trusted publisher for #109 still has to be registered by a PyPI
account owner; the [requirement inventory](issue-110-analysis.md) records it.
