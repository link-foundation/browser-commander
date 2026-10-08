# Issue 138: requirements and implementation plan

All work belongs to PR 139 on `issue-138-e1313c36b251`. Read issue bodies,
all conversation comments, inline review comments, and reviews before changing
code. Keep each independently useful step in a forward-moving commit.

This checklist records the state before publication. The PR's current-head
checks and ready status record the completion of the publication steps.

## Work checklist

- [x] Read parent issue and all four child issues and comments; inspect PR 139.
- [x] Research primary upstream documentation, known problems, and reusable components.
- [x] Map every requirement below to JavaScript, Python, Rust, engines, CLI, exports, and docs.
- [x] Add minimal reproducing tests before each fix; preserve experiments in `experiments/issue-138`.
- [x] Implement navigation policy/deadline/cancellation and test elapsed time and cleanup.
- [x] Implement safe launch diagnostics and test failure categories and cleanup.
- [x] Implement reusable element/flag/subscription APIs and packaging fixes.
- [x] Implement snapshot/session workflows with profile protections intact.
- [x] Add release fragments (versions are assigned by CI; do not edit them manually).
- [x] Run local language CI checks, unit suites, and real local browser acceptance tests.
- [x] Review the complete diff, generated assets, API coverage, and all scope requirements.
- [x] Fetch and incorporate the current default branch, preserving commit history.
- [x] Push only the prepared branch; rewrite the existing PR title/body.
- [x] List recent CI runs with timestamps and head SHA; preserve failing logs in `ci-logs/`.
- [x] Analyze exact failures and log lines; fix and retest the affected paths.
- [ ] Confirm current-head checks pass, working tree is clean, and mark PR 139 ready.

## Complete requirement inventory and candidate solutions

| Issue | Requirement                                                                                         | Proposed solution and validation                                                                          |
| ----- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 134   | Forward per-call network-idle, URL stabilization, and sampling choices in managed navigation        | Configure existing readiness checks; regress tracked no-wait calls.                                       |
| 134   | One end-to-end deadline for navigation, redirects, readiness, verification, and event-started waits | Thread a monotonic operation deadline through manager/checks and engine calls; test real elapsed budgets. |
| 134   | Joining a running wait must respect the joining caller's shorter deadline                           | Bound each caller independently; avoid policy-incompatible promise reuse.                                 |
| 134   | Caller cancellation; deterministic listener and page-trigger cleanup                                | Propagate abort/cancellation through waits; test abort before/during navigation and subscriptions.        |
| 134   | Distinguish interrupted, timed-out, and observed success                                            | Add structured interrupted outcome; preserve existing boolean wrappers.                                   |
| 134   | Safe defaults, tracking and protections stay enabled                                                | Retain default checks; exercise omitted options.                                                          |
| 134   | Equivalent supported engine/language contracts and honest documentation                             | Apply contracts throughout implementations; record actually exercised platforms.                          |
| 134   | Real no-request, continuous-request, redirect, stall, selector-positive fixtures                    | Local-only bounded integration fixtures with elapsed assertions and cleanup.                              |
| 135   | Stable launch failure shape: phase, engine, exit code/signal, categories                            | Typed/structured launch error wrapping discovery, spawn, endpoint and connect.                            |
| 135   | Bounded stderr evidence, preserved cause, caller redaction                                          | Bounded capture, default secret/path scrubbing, redactor hook before exposure or logging.                 |
| 135   | Missing executable, early exit/bad flags, timeout, port race                                        | Fake executable fixtures and injected endpoint/process probes; cleanup assertions.                        |
| 135   | Hardened-container guidance and explicitly insecure fallbacks only                                  | Document sandbox/resource/library configuration; real launch with explicit container settings.            |
| 135   | Preserve launch parity/profile restrictions; no automatic privileges/cookie import                  | Keep existing restrictions; verify defaults and cleanup.                                                  |
| 135   | Align language error contracts where possible                                                       | Shared names/categories and equivalent native errors.                                                     |
| 136   | All `on*` subscriptions return unregister function                                                  | Central manager subscription returns idempotent remover; test repeated cleanup.                           |
| 136   | `findToggleButton({ texts })`                                                                       | Accept ordered alternatives while retaining `textToFind`.                                                 |
| 136   | `findFirst({ selectors, visible })`                                                                 | Reuse engine adapter query/visibility operations.                                                         |
| 136   | `hasText({ texts, normalizeWhitespace })` including nonbreaking spaces                              | Browser text evaluation with explicit normalization and matching semantics.                               |
| 136   | Nth element click/scroll/enabled operations                                                         | Non-negative index option through shared engine selection; first remains default.                         |
| 136   | `isChecked` and idempotent `check` for checkbox/radio                                               | Observe checked property; click only if needed and verify outcome.                                        |
| 136   | Non-clearing flag read and click-listener uninstall, interruption distinguishable                   | Retain handlers for removal; structured flag result alongside compatible API.                             |
| 136   | Generic disabled class default                                                                      | Replace site-specific loading class with `disabled` in every implementation.                              |
| 136   | Optional lazy SQLite native dependency                                                              | Move to optionalDependencies; lazy constructor only when SQLite is used, actionable missing-module error. |
| 136   | Resolve production audit issues in command-stream graph                                             | Inspect registry/upstream fixed versions; update or isolate offending dependency path and audit.          |
| 136   | Upgrade links-notation to compatible 0.23 range                                                     | Update dependency/lock and run notation/trace tests.                                                      |
| 136   | Document minimum Bun or fallback for CDP                                                            | Document consumer-confirmed Bun 1.4.2 minimum and explicit engine-launch alternative.                     |
| 137   | First-class browser-backed cookie reads, macOS default; Keychain opt-in                             | Reuse protected snapshot launch and storage state APIs, domains filtered before returning.                |
| 137   | At most one credential prompt per call and Always Allow guidance                                    | Resolve credentials once per import and propagate cached key; document OS access choice.                  |
| 137   | Cookie-only snapshot inclusion filter                                                               | Copy Local State and Cookies/WAL/SHM only, reusing safe snapshot boundaries.                              |
| 137   | Bundled Chromium mock keystore support                                                              | Explicit mock-key option, appropriate derivation/engine snapshot launch, no guessing fallback.            |
| 137   | Document engine-to-real profile cookie incompatibility                                              | Explain encrypted-profile provenance and compatible launch choice.                                        |
| 137   | Running-browser `setCookies` / domain-scoped `clearCookies`                                         | Normalize session expiry and sameSite; use context cookie APIs for each engine.                           |
| 137   | Opt-in session-cookie persistence                                                                   | Save/restore restricted-permission storage state on close/start for dedicated profiles.                   |
| 137   | All catalogue snapshot browsers and edge/msedge aliases                                             | Derive channel/executable mapping from shared browser catalogue.                                          |
| 137   | macOS default browser resolution                                                                    | Parse modern LaunchServices associations and preserve null for no evidence.                               |
| 137   | `findSiteSessions({ domains, isLoggedIn })` across sources/profiles/snapshots                       | Ordered discovery, optional live validation, structured source/results, deterministic cleanup.            |
| 138   | One PR fully addressing all child issues                                                            | Complete this checklist in PR 139; document any already-resolved requirement with evidence.               |
| 138   | Every issue closes on merge                                                                         | Include separate `Fixes #138`, `Fixes #134`, `Fixes #135`, `Fixes #136`, `Fixes #137` lines.              |

## Design choices

Prefer the existing deadline/readiness, engine adapters, source catalogue,
SQLite backup, storage-state and profile-protection machinery. Evaluate
Playwright/Puppeteer built-ins, Chromium OS-crypt source, browser-cookie3,
Node AbortSignal, and upstream command-stream dependency fixes before adding
another dependency. Experiments remain finite and use only authored local
pages and artificial cookies/profiles. Save lengthy check output to log files.

## Root causes and implementation coverage

### Issue 134

Managed navigation forwarded only the URL, native wait policy, and timeout.
Event-triggered readiness started its own default wait and could replace the
caller's policy. Engine navigation, URL stabilization, and verification also
received independent budgets. A successful void-returning stabilization sleep
was interpreted as a failure. The operation deadline now owns every phase;
managed events observe that operation instead of starting another wait. A
joining caller owns its remaining budget and cancellation. `setContent` uses
the same managed contract.

| Language   | Implementation                                                                                                                                                          | Regression evidence                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| JavaScript | `browser/navigation.js`, `core/navigation-operation.js`, `core/navigation-manager.js`, `core/navigation-readiness.js`, `core/network-tracker.js`, `core/url-tracker.js` | `tests/unit/core/navigation-budget.test.js`, `navigation-manager.test.js`, `tests/e2e/navigation-budget.e2e.test.js` |
| Python     | `browser/navigation.py`, `core/navigation_operation.py`, `core/navigation_manager.py`, `core/navigation_readiness.py`, `core/network_tracker.py`                        | `tests/unit/core/test_navigation_budget.py` and real Playwright navigation                                           |
| Rust       | `browser/navigation_ops.rs`, native Chromiumoxide, Playwright, Node bridge, and Fantoccini `goto_with_options`                                                          | Navigation unit tests and `tests/reusable_session.rs` across three engines                                           |

Paths are relative to each language's `src`/test directories. The shared guide
records native wait-policy limits: classic WebDriver cannot observe network
idle, and cancellation cannot retract an already dispatched engine command.

### Issue 135

Early-exit endpoint polling discarded subprocess evidence. The new launch
boundary retains a bounded stderr tail and a sanitized cause, classifies
discovery/spawn/endpoint/connect failures, and passes the caller redactor through
public launch options. Retained process output is bounded independently of
error formatting; raw forwarding remains explicitly verbose. Endpoint and exit
listeners are removed on completion. Regression tests also caught URL-userinfo
leakage and a Unicode character limit that exceeded the documented byte limit;
public evidence now has a UTF-8 byte limit.

| Language   | Implementation                                                                                                                             | Regression evidence                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| JavaScript | `browser/launch-diagnostics.js`, `browser/real-browser.js`, `browser/debugging-port.js`, `utilities/subprocess.js`, public launcher/export | `tests/unit/browser/launch-diagnostics.test.js`, real-browser/endpoint/process tests  |
| Python     | `browser/launch_diagnostics.py`, `browser/real_browser.py`, `browser/debugging_port.py`, `utilities/subprocess.py`, public launcher/export | `tests/unit/browser/test_launch_diagnostics.py`, existing injected real-browser tests |
| Rust       | `browser/launch_diagnostics.rs`, `browser/real_browser.rs`, `browser/debugging_port.rs`, `utilities/subprocess.rs`, public launcher/export | Launch diagnostic units and `real_browser_tests.rs`/launcher tests                    |

### Issue 136

Subscription registration omitted a remover. Selection adapters always chose
the first element; helpers lacked ordered alternatives, text normalization and
native idempotent form controls. Flag reads conflated an interrupted evaluation
with a negative observation. All affected public helpers, bindings, factories,
engine selection, visibility, click/scroll, dialog and cleanup subscriptions
were updated in all three languages. Existing single-text and boolean wrappers
remain available. Duplicate-callback tests verify remover idempotence.

`elements/reusable`, `elements/locators`/`visibility`,
`interactions/click`/`scroll`, and `high-level/universal-logic` (language-native
filenames) implement these contracts. Real authored-page acceptance tests are
`js/tests/e2e/reusable-session.e2e.test.js`,
`python/tests/e2e/test_reusable_session.py`, and
`rust/tests/reusable_session.rs`. Public root exports and commander bindings
are exercised through those tests.

SQLite was imported eagerly through both cookie reading and migration. The
optional lazy loader and shared online-backup helper cover both paths. The
packed-install experiment in `experiments/issue-138/optional-sqlite.sh` imports
the public package with optional dependencies omitted. `links-notation` now
uses `^0.23.0`; notation/trace regressions verify compatibility.

The reported five production audit vulnerabilities were **already resolved in
the prepared dependency graph**: both the initial and final
`npm audit --omit=dev --json` reports contain zero vulnerabilities. The lockfile
already resolves `command-stream@1.4.0`; retain its compatible process API.
Bun 1.4.2 is the consumer-confirmed minimum documented with a Node fallback,
without claiming that every upstream CDP issue is resolved.

### Issue 137

Direct Chromium reads always used the OS credential path, full snapshots copied
unrelated profile data, and the snapshot channel map was a hard-coded subset.
Browser-backed reads now use a protected cookie-only snapshot and the catalogue
for channel resolution. Direct readers acquire a key once per call and support
explicit macOS/Linux mock derivation. Cookie-only online backup folds committed
WAL data into the snapshot; source files remain read-only and symlink paths are
excluded.

Runtime cookie helpers normalize session expiry/SameSite and delete by domain
boundary. Storage state and opt-in persistence use atomic restricted-permission
files. Persistence requires an explicit dedicated profile and rejects disposable
snapshot use. Discovery closes every launched context, retains per-source
provenance/errors, and reads Firefox/Safari sources through the existing database
readers. Their optional live validation imports cookies into a fresh context.
Modern macOS default-browser lookup queries the active HTTPS application when
legacy LaunchServices data is empty.

All three languages implement `browser_cookie_session`, `session_cookies`,
`session_persistence`, cookie readers, snapshot filtering, storage-state adapters,
default-browser lookup, and public exports (JavaScript uses hyphenated names).
Session workflow units reproduce failed validation/close cleanup, domain suffix
boundaries, persistence opt-in/permissions, modern resolver fallback, and
non-Chromium discovery. Snapshot units/integrations check committed WAL content
and exclusion of history. Live tests verify native checks, context-wide HttpOnly
cookies, session persistence, and engine-created profile discovery.

## Research and alternatives

The [shared guide](../../../../../../docs/navigation-launch-and-sessions.md#upstream-research-and-component-choices)
links primary upstream sources and records each component decision. Native
Playwright/Puppeteer context APIs, existing deadline adapters, SQLite online
backup, and the browser catalogue solve the underlying problems without adding
a second navigation or profile system. `browser-cookie3` was evaluated but does
not avoid OS credential prompts. Automatic sandbox opt-outs, profile mutation,
key guessing, or a silent switch of launch mode would violate existing contracts
and were excluded from the solution.

## Validation and limits

| Implementation         | Local automated validation                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| JavaScript             | ESLint/Prettier/duplication, 1,755 unit tests, 38 live Playwright/Puppeteer/WebDriver cases                 |
| Python                 | Ruff/format/mypy/size, 1,243 unit tests on Python 3.9, two live Playwright cases                            |
| Rust                   | rustfmt/size/strict all-feature Clippy, 748 tests including doctests, three live cases across three engines |
| Repository             | Script lint, secret scan, shared assets, required docs, generated matrices, file limits                     |
| Packaging/reproduction | Packed import without optional SQLite; original navigation/early-exit calls                                 |

Local acceptance uses Linux, authored local pages, and artificial profiles and
cookies. Platform unit fixtures cover macOS/Windows discovery, crypto, and
diagnostics; they do not establish live Keychain behavior. Windows mock cookie
decryption and classic WebDriver context-wide cookie inventory are explicitly
unsupported; matching-engine launch and supported context APIs are documented
alternatives. Generated feature parity is updated from automated test claims.

CI logs are kept locally in `ci-logs/`. Compare timestamps and `headSha` with
the latest pushed commit before accepting a green run: the initial successful
runs were for the placeholder commit and did not validate this implementation.

## First current-head CI investigation

The first implementation head was `75d70b76e8afad1cf978254aa7f9645f916779c8`;
its runs started at `2026-10-08T19:27:44Z`. Preserve the full workflow logs,
not just the final gate's exit status:

- `browser-parity-37832122813.log:3084` and `:4874`: new JavaScript/Python
  fixtures assumed cached Playwright executables, while parity CI supplies
  `CHROME_PATH`. Reuse the existing Chrome/sandbox configuration; verify both
  engines and the Python fixtures against that executable.
- `browser-parity-37832122813.log:549` and `:659`: native WebDriver BiDi
  requires a cookie domain even when the public API accepts a URL/current
  page. A failing unit reproduces both omitted-domain paths. Resolve the
  hostname, retain explicit domain/secure values and session expiry, and
  verify the existing native engine matrix and WebDriver cookie suites.
- `python-ci-37832122808.log:4033`: the new subscription helper evaluated
  `list | None` on Python 3.9. Postpone annotations, then run all 1,243 tests
  on Python 3.9.25, including the public import used by the original failure.
- `javascript-ci-37832122930.log:4432`: a storage-state unit assumed `/tmp`
  exists on Windows. Give the save test its own `os.tmpdir()` directory and
  assert the persisted JSON, with deterministic cleanup.
- Adapter review found Rust native Playwright omitted the requested timeout
  from driver metadata. A bounded stalled-server test fails before the fix
  (`rust-driver-timeout-before.log:8`) and passes after forwarding the timeout
  through the existing channel API. The outer navigation budget alone could
  conceal this adapter-level omission.

CodeQL alerts [67](https://github.com/link-foundation/browser-commander/security/code-scanning/67)
and [68](https://github.com/link-foundation/browser-commander/security/code-scanning/68)
flagged Chromium's public `peanuts` / `mock_password` constants. These are
required only to decrypt existing mock-keystore profiles selected explicitly
by the caller, not to create application credentials or new encrypted data.
The exact two alerts are recorded as false positives with that justification;
the rule and the security workflow remain enabled. The shared research guide
links Chromium's implementations. Ordinary profile reads keep OS credentials,
and mock derivation never becomes an automatic fallback.
