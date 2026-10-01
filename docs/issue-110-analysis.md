# Issue #110: requirements and implementation analysis

This inventory covers [#107](https://github.com/link-foundation/browser-commander/issues/107),
[#108](https://github.com/link-foundation/browser-commander/issues/108), and
[#109](https://github.com/link-foundation/browser-commander/issues/109), including their
comments reviewed through 2026-09-30, including the request to deliver all sub-issues in PR #111. It records the implementation route for each
requirement so the combined PR can be reviewed against the full scope. A plan
below does **not** imply the implementation is complete.

## #107: disposable browser must not ask to become the default

| Requirement                                                                                     | Solution and verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No default-browser prompt on fresh headful launch; no extra browser switch or page-visible flag | Write `browser.check_default_browser=false` to `Default/Preferences`. Chrome 153 still displayed the infobar with only this older preference, so also set the `Local State` `browser.default_browser_infobar_declined_count` and `browser.default_browser_declined_count` to five. Chromium's [prompt manager](https://github.com/chromium/chromium/blob/main/chrome/browser/ui/startup/default_browser_prompt/default_browser_prompt_manager.cc) checks these counters. The X11 browser-window experiment shows the infobar before (5,073 pixels in its strip) and none after (zero).                                                                                                                                          |
| Snapshot/attach copies, including a selected non-Default profile                                | Apply profile settings after copying/migrating, and write the selected profile's Preferences. Snapshot tests cover the copied values and `Profile 1`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Edge and Brave                                                                                  | Chromium-family launches use the same seeding path. Edge's own first-run prompt is already suppressed through `fre.has_user_seen_fre`. X11 captures cover Edge in this environment; Brave is unavailable here and needs a machine with Brave installed for direct validation.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Named default-browser opt-out and arbitrary preferences/Local State                             | Expose `defaultBrowserCheck`, `preferences`, `localState` (`snake_case` in Python/Rust); deep-merge objects after the built-in defaults, with the named option taking precedence over the generic preference. Tests cover nested merges and opting the prompt back in.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Managed policies where supported                                                                | Chromium's [enterprise policy documentation](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/enterprise/policies.md) and [policy scopes](https://support.google.com/chrome/a/answer/9037717) place platform policies in Linux system paths, Windows policy registry keys or macOS managed preferences. There is no profile-local policy file with launch-only scope, so writing policies could affect the user's other browser windows. The current safe route is to inherit OS-installed policies and document their paths and scope. A future API could accept an isolated browser binary or OS-user sandbox, then install policy in that isolated scope; this is a platform-level feature, not a Preferences key. |
| Existing restrictions/args; every default and opt-out documented                                | Preserve the existing launch argument paths. [Browser profile settings](browser-profile-settings.md) has one table for the First Run sentinel, What's New version, Edge welcome flag, preference, and both counts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Browser-window verification of default, unsupported-flag and automation bars                    | [X11 capture experiment](../experiments/issue-110/capture-infobar.py) records the complete Chrome/Edge window rather than a page screenshot; CI runs it under Xvfb. A cross-platform follow-up can use macOS `screencapture -l` and Windows `PrintWindow` with the same visual assertion.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| JavaScript, Python, Rust, CLI parity                                                            | Seed from each native launcher; expose CLI `--pref`, `--local-state`, `--default-browser-check`, and `--first-run` through the shared command script. The Python/Rust CLIs forward their scripts to that JavaScript CLI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## #108: native and typed cross-language parity

The generated [feature matrix](feature-parity.md) currently tests 14 shared
features. Its explicit limitations and manual “Not implemented” or
“Not supported” cells show that the full parity requirement remains open. The
following is the implementation plan for **every** numbered requirement in
[#108](https://github.com/link-foundation/browser-commander/issues/108).

| Requirement                                                                                                     | Existing path and proposed solution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Test/gate                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Full typed Rust Playwright through the official driver, spawned with command-stream; generic bridge fallback | Replace the 27-operation `node_engine_bridge.js` surface with a driver-backed adapter. [`playwright-rs` 0.19](https://docs.rs/playwright-rs/latest/playwright_rs/) is a candidate because it already uses the Playwright driver; evaluate its exact driver/version and process hooks before integrating. Keep the generic bridge only for API methods the driver binding cannot expose.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Parse the current upstream protocol specification YAML files (formerly `protocol.yml`); compare protocol objects and methods to generated Rust bindings, with allowlisted internal protocol objects only. Add end-to-end launch/attach tests without Node package resolution. |
| 2. Typed Rust and Python Puppeteer wrappers generated from `.d.ts`                                              | Use the installed Puppeteer's TypeScript declarations as the source of truth. Parse declarations with the official TypeScript compiler API, normalize overloads and generic types to a stable method manifest, then generate Python stubs/wrappers and Rust handle types around the bridge. Avoid pretending a method is typed when it is only a string call.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Regenerate in CI and compare files; test that every public class/method in the manifest has a callable wrapper and execute representative overloads through the bridge.                                                                                                       |
| 3. Native Rust/Python recording of all 12 trace facets                                                          | Reuse the existing portable schema and reader, but add CDP listeners to native adapters for navigation, network events, DOM mutation batches and stable node identity. Port the JS checkpoint/redaction/partial-failure logic and bundle writer; retain the same offline viewer and Links Notation exporter.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Cross-read traces in all three languages, plus browser tests for every facet: record, checkpoints, DOM batches, navigation survival, live state, identities, ordered timeline, redaction, partial bundles, viewer, Links export, retain-on-failure.                           |
| 4. Rust Selenium managed launch, typed API, downloads and BiDi                                                  | The current `fantoccini` dependency is a WebDriver client, not a driver launcher. Spawn chromedriver/geckodriver through Rust command-stream, discover the WebDriver endpoint, and connect Fantoccini. Wrap its typed session/element operations in the common engine API, attach a staging-directory download watcher, and add a BiDi transport where the driver exposes it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Local Chrome and Firefox WebDriver launch/close, download and BiDi tests; failure cleanup and driver exit tests.                                                                                                                                                              |
| 5. Portable state, snapshot attach, extension relay, native parity probe in every engine/language               | Standardize on Playwright's `cookies`/`origins[].localStorage` JSON. JS, Python and Rust now implement cookie/localStorage import/export in the Playwright, Puppeteer and native engines. Python/Rust now snapshot selected live profiles with SQLite backup, exclusion reports and owned-copy cleanup; real Chrome tests keep the source open while copies launch in both Python engines and all three Rust CDP engines. Rust now implements native typed parity measurement with the shared probe, switch parser and limitations catalogue. Its reference process uses command-stream without CDP; three-engine browser tests include a webdriver negative control and borrowed-session ownership. Python and Rust now host the native typed extension relay with origin/ID checks, tabs, CDP sessions/events and bounded request cleanup. Both packages bundle the shared companion extension. | Python Playwright↔Selenium and Rust Chromiumoxide→Playwright→Puppeteer browser tests; snapshot of a live WAL profile; authenticated extension attach; Rust reference-vs-driven parity run with the same report shape.                                                         |
| 6. Python command-stream equivalence                                                                            | Python already has [`utilities.subprocess`](../python/src/browser_commander/utilities/subprocess.py) with exact argv, streaming listeners, exit status and graceful kill. A separate PyPI port of `command-stream` is an option if a standalone project is desired. The equivalent wrapper is documented and tested for streaming, nonzero exits, graceful termination and cancellation; the cancellation regression now reaps the child before propagating the cancelled task.                                                                                                                                                                                                                                                                                                                                                                                                                   | Tests for early output, simultaneous stdout/stderr, nonzero exit, kill escalation and cancellation.                                                                                                                                                                           |
| 7. Generated matrix with `native typed`, `typed via bridge`, `untyped via CLI` and CI minimum                   | Implemented the three-level test claims and generator gate. The gate rejects CLI-only access without a current technical limitation, missing tier labels and stale limitations. Native snapshot claims are now tested in Python and Rust; the matrix still identifies the other native gaps.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Generator fixture tests for each level, an absent claim, unjustified CLI-only claim, and stale limitation; run `--check` in CI.                                                                                                                                               |

The Playwright, Puppeteer and Fantoccini components solve different parts of
this issue; no single dependency supplies native traces, portable state,
snapshot attach, extension relay and the parity matrix. Playwright's
[driver protocol specifications](https://github.com/microsoft/playwright/tree/main/packages/protocol/spec),
Puppeteer's [declaration sources](https://github.com/puppeteer/puppeteer/tree/main/packages/puppeteer-core/src/api),
and Python's [async subprocess documentation](https://docs.python.org/3/library/asyncio-subprocess.html)
are the upstream contracts to track.

### Verified progress and remaining implementation

Python and Rust now expose native `snapshot_user_data_dir` and `launch_snapshot`.
The selected-profile tests preserve committed WAL rows while excluding an
uncommitted transaction. Browser tests launch Profile 1 copies without closing
the source, then verify deletion of the copies. Python also tests connection
failure and cancellation cleanup, symlink exclusions and partial-database
cleanup. An exclusive-lock regression exposed Python backup busy retries and
Rust's five-second SQLite busy handler; both now fall back without waiting for
the browser to exit. Rust's three-engine smoke test fell from 237 seconds to
9 seconds after this fix. CI runs native snapshot launches in a separate job.

Rust Playwright now drives the official driver. `playwright-core/cli.js
run-driver` is started through command-stream, using its binary-safe stdin and
stdout API (`rust/src/playwright/transport.rs`), not the UTF-8 line wrapper.
The typed client in `rust/src/playwright/protocol/` is generated by
`scripts/generate-playwright-protocol.mjs` from Playwright's protocol spec,
vendored from tag v1.62.1. We did not add the `playwright-rs` dependency
because it spawns its own server with Tokio pipes. `PlaywrightDriverPage`
implements `EngineAdapter` on the typed client, and `page.objects()` exposes
the typed `Browser`, `BrowserContext`, `Page` and `Frame` channels for
everything else. `launch_browser()` and `connect_browser()` use the driver
whenever a `playwright-core` with the same protocol version is installed, and
fall back to the Node bridge only when it is not.

These checks cover it:

- `js/tests/unit/playwright-protocol-coverage.test.js` fails when the bindings
  are stale, miss any interface, command (own or inherited) or event of the
  spec, or when the spec disagrees with the validator of the installed driver.
- `rust/tests/playwright_driver.rs` runs the typed API and the
  driver-or-bridge selection against real Chrome in the Browser Parity
  workflow.

Rust and Python Puppeteer are now typed over the bridge.
`scripts/puppeteer-api.mjs` reads puppeteer-core's `lib/types.d.ts` with the
TypeScript compiler API into `rust/protocol/puppeteer/api.json`: 46 public
classes and interfaces with their own and inherited methods and getters, and a
wire kind for each parameter and result. `scripts/generate-puppeteer-bindings.mjs`
generates `rust/src/puppeteer/api/` and
`python/src/browser_commander/puppeteer/api/` from it. Each Puppeteer type
becomes a Rust struct or Python class over a bridge handle. Each member becomes
an `async` method that encodes its arguments, decodes the result into the
declared type and wraps a handle in the class of its runtime type. The bridge
clients (`rust/src/puppeteer/bridge.rs`,
`python/src/browser_commander/puppeteer/bridge.py`) own the `serve --stdio`
process and deliver events, including one emitted in the same chunk as the
subscribe response.

These checks cover it:

- `js/tests/unit/puppeteer-bindings-coverage.test.js` fails when the bindings
  are stale, when the manifest disagrees with the installed puppeteer-core, or
  when any method declared in `lib/types.d.ts` lacks a typed Rust or Python
  entry point.
- Unit tests against a fake server check encoding, decoding, errors, events
  and shutdown in both languages.
- `rust/tests/puppeteer_bridge.rs` and
  `python/tests/e2e/test_puppeteer_bridge.py` drive real Chrome through the
  typed API in the Browser Parity workflow.

Rust also exposes native `measure_parity` and `measure_session_parity`. A plain
command-stream reference browser loads the same probe as the driven browser,
without attaching a debugger to the environment reference. A separate launch
reads Chrome's actual command line. Reports preserve unknown differences and
use the shared limitations catalogue. Unit tests cover switch parsing, missing
values, explanations and reference argv; real Chrome tests cover all three CDP
engines and a webdriver negative control. The shared-asset gate checks the
probe bytes in every package.

Python and Rust now expose native typed extension relay APIs. Real loopback
WebSocket tests exercise origin/ID authorization, single-extension admission,
tabs, CDP calls/events, remote errors, timeouts and disconnect cleanup. The
packages ship byte-identical copies of the JavaScript companion extension; the
shared-asset gate verifies them. [Native extension relay](extension-relay.md)
documents installation, both APIs, cancellation and bounded event streams.

Python now records portable traces natively (item 3).
`BrowserCommander.start_trace()` writes the same bundle as JavaScript:
checkpoints, continuous DOM mutation batches that survive navigations and new
frames, live control state, stable identities, one ordered timeline,
redaction, size-limited partial bundles, the offline viewer and a streamed
Links Notation export. The in-page capture functions and the viewer are not
rewritten: `scripts/generate-trace-assets.mjs` copies them out of
`js/src/traces/` into `assets.json`, and a JavaScript test fails when the copy
is stale. `traced()` keeps a bundle only when the block raises, which is what
`retain-on-failure` means without a test runner.

These checks cover it:

- `scripts/generate-trace-conformance.mjs` records one scenario with the
  JavaScript recorder into `js/tests/fixtures/traces/conformance/expected/`.
  `python/tests/unit/traces/test_conformance.py` replays it and must produce
  the same bundle, viewer and `.lino` bytes, and redact a 21-URL corpus the
  same way.
- `python/tests/unit/traces/` ports the JavaScript recorder, bundle, viewer,
  Links and redaction tests, and `test_retention.py` covers `traced()`.
- `python/tests/e2e/test_trace_recording.py` records a real Chrome run (typing,
  a password, a dialog, a navigation and DOM changes) and opens the viewer in
  it, in the Browser Parity workflow.

Rust now records portable traces natively too, which completes item 3.
`traces::start_trace` writes the same bundle as JavaScript and Python, over
any `EngineAdapter` through `AdapterTracePage`. Like Python, it runs the
JavaScript capture functions and viewer from `assets.json` rather than
rewriting them. Page activity reaches the recorder through the new
`EngineAdapter::trace_events` stream. The chromiumoxide adapter fills that
stream from CDP navigation, console, exception, network-failure and dialog
events, and installs the recorder's init script in every new document.
`write_trace_viewer` and `write_trace_links` (or `TraceOptions::links` while
recording) write the offline viewer and the Links Notation export.
`record_scenario` keeps a bundle only when the run fails, which is what
`retain-on-failure` means without a test runner. Two gaps remain and are
marked in the [feature parity](feature-parity.md#portable-traces) table:
chromiumoxide does not report downloads, and Rust drains mutation batches from
the main frame only.

These checks cover it:

- `rust/tests/trace_conformance.rs` replays the conformance scenario and must
  produce the JavaScript bundle, viewer and `.lino` bytes, and redact the URL
  corpus the same way.
- `rust/tests/trace_recorder.rs` covers modes, event sources, capture failures
  and strict mode, stopping once with an error, discarding, and
  `record_scenario`; `rust/src/browser/cdp_trace_events.rs` unit-tests the CDP
  event translation.
- `rust/tests/trace_record_real_browser.rs` records a real Chrome run (a
  navigation, typing, a password, DOM changes, console output and a page error)
  in the Browser Parity workflow.
- `experiments/trace-harness/` compiles the trace sources and tests without
  chromiumoxide, for machines whose memory cannot build its CDP crate.

See the [CI investigation](issue-110-ci-investigation.md) for the failed runs,
exact errors and reproducing checks addressed in this continuation.

## #109: first Python release

| Requirement                                                       | Solution and verification                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Register a PyPI pending trusted publisher for `browser-commander` | A PyPI account owner must register GitHub organization `link-foundation`, repository `browser-commander`, workflow `python.yml`, project `browser-commander`, and leave environment empty. [PyPI's pending-publisher guide](https://docs.pypi.org/trusted-publishers/creating-a-project-through-oidc/) confirms this creates the project on first publish. The repository's GitHub credentials do not grant PyPI account access. |
| Run release and verify publication                                | After registration, run `gh workflow run python.yml --repo link-foundation/browser-commander` with its patch-bump input, inspect the run and verify `https://pypi.org/pypi/browser-commander/json` returns release metadata. No package exists at that endpoint yet.                                                                                                                                                             |
| Truthful installation and badge until release                     | Remove the 404 badge, document direct source installation, and restore PyPI wording only after the package is available.                                                                                                                                                                                                                                                                                                         |
| Actionable pipeline failure                                       | `python/scripts/explain_pypi_failure.py` and the existing workflow already classify `invalid-publisher` and emit a setup link. Retain and test that diagnostic. No long-lived API token is needed: [PyPI trusted publishing](https://docs.pypi.org/trusted-publishers/) uses GitHub OIDC.                                                                                                                                        |

Native Rust WebDriver launches ChromeDriver/geckodriver through command-stream, exposes the complete typed Fantoccini client, connects optional BiDi, and redirects managed downloads through browser preferences. Real Chrome and Firefox tests cover HttpOnly cookies, localStorage, events, completed downloads and cleanup. Chrome also covers copied-profile ownership and common launcher integration. The Firefox regression excludes `.part` downloads; a separate reproducing test found that dropping a managed process after runtime shutdown left it alive, fixed by synchronous final process-group cleanup. See [Native WebDriver](native-webdriver.md).
