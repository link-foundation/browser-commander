# Browser Commander Feature Parity

This matrix tracks the shared API surface across the maintained language implementations. "Supported" means the public helper exists and is covered by unit tests or adapter tests in that language. "Bridge" means the Rust API is implemented by delegating to the official Node.js engine package.

## Engine Matrix

| Engine        | JavaScript                                     | Rust                    | Notes                                                                                                                                                |
| ------------- | ---------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Playwright    | Supported through the official Node.js package | Bridge through Node.js  | Playwright's official language list covers JavaScript/TypeScript, Python, Java, and .NET. Browser Commander uses Node for Rust Playwright execution. |
| Puppeteer     | Supported through the official Node.js package | Bridge through Node.js  | Puppeteer documents itself as a JavaScript library for driving Chrome/Firefox over CDP or WebDriver BiDi.                                            |
| Chromiumoxide | Not applicable                                 | Native Rust             | Rust CDP backend.                                                                                                                                    |
| Fantoccini    | Not applicable                                 | Engine type preserved   | Managed launch is not implemented; keep the variant for compatibility and future WebDriver support.                                                  |
| Selenium      | Not applicable                                 | Not implemented in Rust | Python-specific backend today.                                                                                                                       |

## API Matrix

| Capability                              | JavaScript Playwright | JavaScript Puppeteer | Rust Chromiumoxide | Rust Playwright bridge | Rust Puppeteer bridge |
| --------------------------------------- | --------------------- | -------------------- | ------------------ | ---------------------- | --------------------- |
| Launch browser                          | Supported             | Supported            | Supported          | Supported              | Supported             |
| Connect to running browser over CDP     | Supported             | Supported            | Supported          | Bridge                 | Bridge                |
| Persistent user data directory          | Supported             | Supported            | Supported          | Supported              | Supported             |
| Portable cookie/localStorage state      | Supported             | Supported            | Not implemented    | Not implemented        | Not implemented       |
| Custom Chrome args                      | Supported             | Supported            | Supported          | Supported              | Supported             |
| Headless launch                         | Supported             | Supported            | Supported          | Supported              | Supported             |
| Color scheme at launch                  | Supported             | Supported            | Supported          | Supported              | Supported             |
| Navigate / current URL                  | Supported             | Supported            | Supported          | Supported              | Supported             |
| Query selectors / count                 | Supported             | Supported            | Supported          | Supported              | Supported             |
| Visibility / enabled checks             | Supported             | Supported            | Supported          | Supported              | Supported             |
| Text content / input value / attributes | Supported             | Supported            | Supported          | Supported              | Supported             |
| Click / fill / type text                | Supported             | Supported            | Supported          | Supported              | Supported             |
| Scroll into view                        | Supported             | Supported            | Supported          | Supported              | Supported             |
| Evaluate JavaScript                     | Supported             | Supported            | Supported          | Supported              | Supported             |
| Screenshot                              | Supported             | Supported            | Supported          | Supported              | Supported             |
| PDF                                     | Supported             | Supported            | Supported          | Supported              | Supported             |
| Keyboard press/type/down/up             | Supported             | Supported            | Supported          | Supported              | Supported             |
| Bring page to front                     | Supported             | Supported            | Supported          | Supported              | Supported             |
| Wait for navigation                     | Supported             | Supported            | Supported          | Supported              | Supported             |

## Documentation Outputs

| Output                  | Command                                         | CI/CD                                    |
| ----------------------- | ----------------------------------------------- | ---------------------------------------- |
| JavaScript API docs     | `cd js && npm run docs:api`                     | Built by `.github/workflows/docs.yml`    |
| Rust API docs           | `cd rust && cargo doc --no-deps --all-features` | Built by `.github/workflows/docs.yml`    |
| Combined Pages artifact | Generated from both outputs                     | Uploaded on PRs and deployed from `main` |

## Real-Browser Lifecycle Parity

| Capability                              | JavaScript            | Rust                                 | Python                  |
| --------------------------------------- | --------------------- | ------------------------------------ | ----------------------- |
| Attach to an existing CDP endpoint      | Playwright, Puppeteer | Chromiumoxide, Playwright, Puppeteer | Playwright, Selenium    |
| Discover an installed Chrome-family app | Linux, macOS, Windows | Linux, macOS, Windows                | Linux, macOS, Windows   |
| Launch with a dedicated profile         | `launchRealBrowser()` | `launch_real_browser()`              | `launch_real_browser()` |
| Loopback-only CDP readiness probe       | Supported             | Supported                            | Supported               |
| Seed cookies after connection           | Supported             | Supported                            | Supported               |
| Return browser and page handles         | Raw engine handles    | Shared `EngineAdapter`               | Raw engine handles      |

## Installed-Browser Cookie Parity

| Capability                                                        | JavaScript | Rust      | Python    |
| ----------------------------------------------------------------- | ---------- | --------- | --------- |
| Discover Chrome, Edge, Brave, Chromium, and Firefox profiles      | Supported  | Supported | Supported |
| Read Playwright-compatible cookie fields                          | Supported  | Supported | Supported |
| Filter by domain and choose a named profile                       | Supported  | Supported | Supported |
| Chromium version-24 host-hash validation and timestamp conversion | Supported  | Supported | Supported |
| macOS Keychain + AES-128-CBC                                      | Supported  | Supported | Supported |
| Linux libsecret/KWallet + AES-128-CBC                             | Supported  | Supported | Supported |
| Windows DPAPI key + legacy AES-256-GCM                            | Supported  | Supported | Supported |
| Firefox `cookies.sqlite`                                          | Supported  | Supported | Supported |
| Owner-only derived-key/result cache with TTL and refresh controls | Supported  | Supported | Supported |
| Cross-process credential-read lock                                | Supported  | Supported | Supported |

Current Windows Chromium app-bound `v20` values require Chromium's privileged
service and are intentionally reported as unsupported for ordinary external
processes. All three APIs can skip those individual values when partial import
is acceptable. The shared derived-key cache uses one schema and lock identity,
so JavaScript, Rust, and Python processes do not independently prompt within a
TTL window. Cache directories/files use `0700`/`0600` modes on POSIX; on
Windows they remove inherited ACL entries and grant access only to the current
user.

## Truthful Click Results and Readiness

A click reports what was observed, not what was attempted (issue #89). `status`
is one of `succeeded`, `failed`, `timed_out`, `interrupted` or `unverified`;
`effect` is `confirmed`, `not-observed` or `contradicted`; and both carry the
evidence behind them. The legacy `success`/`verified` booleans are still
returned and are now derived conservatively - `verified` follows
`effect === 'confirmed'` - so a button that did nothing no longer answers with a
verified click.

| Capability                                                     | JavaScript                                 | Python                            | Rust                      |
| -------------------------------------------------------------- | ------------------------------------------ | --------------------------------- | ------------------------- |
| `status` / `effect` / `evidence` click result                  | Supported                                  | Supported                         | Supported                 |
| One monotonic budget for probe, dispatch and verification      | Supported                                  | Supported                         | Supported                 |
| `activation` axis (`pointer`, `dom`)                           | Supported                                  | Supported                         | Supported                 |
| `scroll` axis (`auto`, `preserve`, `none`)                     | Supported                                  | Supported                         | Supported                 |
| `actionability` axis (`normal`, `force`)                       | Engine `force` flag                        | Engine `force` flag               | Recorded as evidence only |
| `noAutoScroll` / `no_auto_scroll` deprecation notice           | Supported                                  | Supported                         | Supported                 |
| Readiness result with per-check evidence and a shared deadline | Supported                                  | Supported                         | Supported                 |
| Composable readiness checks                                    | URL, network, DOM, images, custom          | URL, network, DOM, images, custom | URL stability only        |
| End-to-end browser coverage                                    | `js/tests/e2e/click-readiness.e2e.test.js` | Unit tests only                   | Unit tests only           |

Explicit gaps behind that table:

- `scroll: 'none'` needs viewport-coordinate pointer input. JavaScript uses
  `page.mouse` (Playwright and Puppeteer both expose it), Python uses
  `page.mouse` (Playwright only), and Rust uses Chromiumoxide's
  viewport-coordinate `page.click(Point)`. Selenium, the Rust Node bridge and
  Fantoccini have no such API, so the request fails with a
  `ScrollConstraintError` naming the alternatives instead of silently scrolling
  the page.
- `actionability: 'force'` maps to the engine's own `force` flag in JavaScript
  and Python. Rust's Chromiumoxide path dispatches through CDP, which has no
  actionability pre-checks to skip, so the axis is recorded in the result's
  evidence and changes nothing. Use `scroll = ClickScroll::None` when the
  intent is "do not scroll".
- Rust readiness has the deadline, the result model and URL stability, but no
  network-idle or DOM-stability checks, because the crate has no
  `NetworkTracker` or `NavigationManager` to read request state from.

## Managed Downloads

`downloads` is accepted by `launchBrowser()`, `connectBrowser()` and
`launchRealBrowser()` - and their Python and Rust equivalents - as `true`, or as
an options object/struct (`directory`, `persist`, `conflict`, `filename`,
`validate`). Every entry point builds the same manager, so the lifecycle does
not depend on how the browser was obtained (issue #88). `commander.downloads`
and `commander.configureDownloads()` expose the same manager in JavaScript and
Python.

| Capability                                                         | JavaScript | Python         | Rust               |
| ------------------------------------------------------------------ | ---------- | -------------- | ------------------ |
| Same `downloads` option on launch, connect and real-browser launch | Supported  | Supported      | Supported          |
| Files survive the page, context and browser that produced them     | Supported  | Supported      | Supported          |
| `capture(options, action)` that cannot race a fast download        | Supported  | Supported      | Supported          |
| Global observation and `capture()` report one download once        | Supported  | Supported      | Supported          |
| Caller-chosen filename, extension repair, traversal refusal        | Supported  | Supported      | Supported          |
| Conflict policies (`rename`, `overwrite`, `error`)                 | Supported  | Supported      | Supported          |
| Content validation before the final name appears                   | Supported  | Supported      | Supported          |
| Failed and cancelled downloads never reported as success           | Supported  | Supported      | Supported          |
| Downloads a person started by hand                                 | Supported  | Supported      | Supported          |
| Test-runner artifact retention                                     | Supported  | No test runner | No test runner     |
| Attach to a browser the caller already has                         | Supported  | Supported      | Chromiumoxide only |

Where each engine's download events come from, and what that costs:

| Engine                             | Source of truth                                                        | Notes                                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| JavaScript Playwright              | Browser-wide CDP session, falling back to the context `download` event | The fallback sees automated downloads only; a download a person started needs the Browser domain.                   |
| JavaScript Puppeteer               | Browser-wide CDP session                                               | `Browser.setDownloadBehavior` plus `downloadWillBegin`/`downloadProgress`.                                          |
| Python Playwright                  | Browser-wide CDP session, falling back to the context `download` event | Same fallback as JavaScript.                                                                                        |
| Python Selenium                    | Staging-directory watcher                                              | Selenium has no download events at all, so the file arriving is the only evidence; no engine progress reporting.    |
| Rust Chromiumoxide                 | `Browser.setDownloadBehavior` plus a staging-directory watcher         | The crate's CDP transport is request/response only, so there is no event stream to listen on.                       |
| Rust Playwright / Puppeteer bridge | Not supported                                                          | The Node bridge speaks its own command protocol rather than CDP; asking for downloads fails with that reason.       |
| Rust Fantoccini                    | Not supported                                                          | WebDriver has neither download events nor a way to redirect downloads; asking for downloads fails with that reason. |

A watcher-based source claims a file once its size has stopped changing and
ignores `.crdownload`, `.tmp` and `.partial` files, so a caller never sees a
half-written download under its final name. What it cannot report is the
engine's own progress percentage, and it identifies a download by the file the
browser wrote rather than by the URL it came from.

`rust/examples/managed_download.rs` drives a real Chromium through the whole
lifecycle - click, capture, close the browser, read the file back - because the
unit tests stage files by hand.

## Portable Traces

A trace is one versioned directory (`manifest.json`, an ordered NDJSON
timeline, per-checkpoint DOM snapshots and the mutation batches between them),
not a private format: whatever recorded it, any of the three languages can read
it (issue #87). `TRACE_SCHEMA_VERSION` is written into the manifest, and a
reader refuses a version it does not understand rather than guessing.

| Capability                                                                                    | JavaScript | Python          | Rust            |
| --------------------------------------------------------------------------------------------- | ---------- | --------------- | --------------- |
| Record a session (`startTrace`, `commander.startTrace`)                                       | Supported  | Not implemented | Not implemented |
| Named checkpoints with HTML, control state, frames and screenshots                            | Supported  | Not implemented | Not implemented |
| Continuous DOM mutation batches across SPA updates and navigations                            | Supported  | Not implemented | Not implemented |
| One ordered timeline for navigation, clicks, console, dialogs, network failures and downloads | Supported  | Not implemented | Not implemented |
| Redaction applied before anything is written                                                  | Supported  | Not implemented | Not implemented |
| Partial trace on truncation, page closure or a size limit                                     | Supported  | Not implemented | Not implemented |
| Read a bundle (`readTrace`, `read_trace`)                                                     | Supported  | Supported       | Supported       |
| Manifest schema-version validation                                                            | Supported  | Supported       | Supported       |
| Checkpoint state and control-state diffing                                                    | Supported  | Supported       | Supported       |
| Offline viewer with scripts and network disabled                                              | Supported  | Not implemented | Not implemented |
| `trace: 'retain-on-failure'` in `browser-commander/tests`                                     | Supported  | No test runner  | No test runner  |

Recording is JavaScript-only today; Python and Rust are readers, which is what
the bundle format exists for. `python/src/browser_commander/traces/` and
`rust/src/traces/` open the same directory a JavaScript run produced, and
`experiments/trace-cross-language-read.mjs` reads one bundle from all three to
prove it.

## Automation-Friendly Launch Defaults

`launchBrowser()`/`launch_browser()` and the real-browser launch helpers add
the following Chromium-family arguments unless the caller opts out. The
defaults are the same on Linux, macOS, and Windows and apply when launching
Chrome, Edge, Brave, or Chromium:

| Default argument                   | Why it is applied                                                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `--password-store=basic`           | Uses the isolated profile's built-in password backend instead of opening an OS Keychain/libsecret credential dialog. |
| `--no-first-run`                   | Skips the first-run setup flow that can cover or redirect the first page.                                            |
| `--no-default-browser-check`       | Prevents a default-browser prompt from interrupting automation.                                                      |
| `--disable-infobars`               | Suppresses browser information bars that can obstruct page UI.                                                       |
| `--disable-session-crashed-bubble` | Prevents a killed automation session from offering to restore tabs.                                                  |
| `--hide-crash-restore-bubble`      | Hides the crash-restore surface on browser variants that honor this switch.                                          |
| `--disable-crash-restore`          | Prevents stale tabs from being restored into the isolated profile.                                                   |

The real-browser helpers additionally manage
`--remote-debugging-address=127.0.0.1`, `--remote-debugging-port=<port>`, and
`--user-data-dir=<dedicated profile>`. These three arguments cannot be
overridden or ignored: CDP stays on loopback, and Chrome 136+ refuses remote
debugging on its default profile. Headless mode is opt-in and emits
`--headless=new`.

Use `extraArgs` and `ignoreDefaultArgs` in JavaScript, `extra_args` and
`ignore_default_args` in Python, or the corresponding Rust builder methods to
append arguments or omit individual Browser Commander defaults. Existing
`args`/`with_args()` calls remain supported. Opting out of
`--password-store=basic` can restore operating-system credential prompts.

`connectBrowser()`/`connect_browser()` only attaches to an existing process;
it cannot change that process's command line. Start an externally managed
browser with the defaults above and a dedicated remote-debugging profile, or
use the real-browser launch helper to have Browser Commander apply them.

## Compatibility Notes

- Existing Rust aliases remain compatible: `chromiumoxide` and `cdp` parse as `EngineType::Chromiumoxide`; `fantoccini` and `webdriver` parse as `EngineType::Fantoccini`.
- `playwright` and `puppeteer` now parse as distinct Rust engine types instead of silently mapping to a different backend.
- Rust Playwright/Puppeteer support requires Node.js plus the matching package in `node_working_dir` or normal Node module resolution.
- Python exposes the same CDP attach operation as `connect_browser()` for its Playwright and Selenium engines.
- Chrome 136 and newer require a non-default user data directory before honoring remote-debugging switches.
