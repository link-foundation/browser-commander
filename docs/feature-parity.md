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

## Profile Migration and No-Automation Open

The default real-browser launch is clean, so a Google sign-in probe reaches
"Couldn't find your Google Account" instead of "This browser or app may not be
secure". Migration from the user's main profile is opt-in and strictly
read-only on the source (SQLite copied through the Online Backup API), and a
no-automation `openInUserBrowser()` mode shows a URL in the user's own browser.

| Capability                                                       | JavaScript                            | Rust         | Python       |
| ---------------------------------------------------------------- | ------------------------------------- | ------------ | ------------ |
| Clean default launch passes the Google sign-in probe             | Supported                             | Supported    | Supported    |
| Opt-in `launchRealBrowser({ migrateFrom })` before launch        | Supported                             | Planned      | Planned      |
| `migrateProfile()` read-only migration report                    | Supported                             | Planned      | Planned      |
| Cookies (Playwright shape, DBSC-bound Google cookies reported)   | Supported                             | Planned      | Planned      |
| Bookmarks (`Bookmarks` JSON copied verbatim)                     | Supported                             | Planned      | Planned      |
| History / Top Sites (SQLite Online Backup snapshot)              | Supported                             | Planned      | Planned      |
| Passwords (`Login Data`, re-encrypted with the target key)       | Supported                             | Planned      | Planned      |
| Preferences subset (language, search engine, theme)              | Supported                             | Planned      | Planned      |
| Extensions (unpacked copy; MAC will not validate, reported)      | Supported                             | Planned      | Planned      |
| Firefox path (`cookies.sqlite`, `places.sqlite`, NSS `key4.db`)  | Supported                             | Planned      | Planned      |
| macOS / Linux / Windows key handling with per-class fixtures     | Supported                             | Planned      | Planned      |
| No-automation `openInUserBrowser(url)`                           | Supported                             | Planned      | Planned      |

Windows app-bound `v20` passwords/cookies are reported `app-bound-v20`, and
migrated extensions are reported `mac-will-not-validate` because Chromium's
`Secure Preferences` MAC cannot be forged externally. Rust and Python track the
same API surface under umbrella #105.

## Truthful Click Results and Readiness

A click reports what was observed, not what was attempted (issue #89). `status`
is one of `succeeded`, `failed`, `timed_out`, `interrupted` or `unverified`;
`effect` is `confirmed`, `not-observed` or `contradicted`; and both carry the
evidence behind them. The legacy `clicked`/`verified` booleans are still
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
  Fantoccini have no such API, so the request fails - with a
  `ScrollConstraintError` in JavaScript and Python, and
  `ClickDispatchError::ScrollConstraint` in Rust - naming the alternatives
  instead of silently scrolling the page.
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
| Recording survives navigation, SPA route changes and new frames                               | Supported  | Not implemented | Not implemented |
| Semantic live state (typing, checking, selecting, focus, scroll)                              | Supported  | Not implemented | Not implemented |
| Stable context, page, navigation, frame and action identities on every record                 | Supported  | Not implemented | Not implemented |
| One ordered timeline for navigation, clicks, console, dialogs, network failures and downloads | Supported  | Not implemented | Not implemented |
| Redaction applied before anything is written                                                  | Supported  | Not implemented | Not implemented |
| Partial trace on truncation, page closure or a size limit                                     | Supported  | Not implemented | Not implemented |
| Read a bundle (`readTrace`, `read_trace`)                                                     | Supported  | Supported       | Supported       |
| Manifest schema-version validation                                                            | Supported  | Supported       | Supported       |
| Checkpoint state and control-state diffing                                                    | Supported  | Supported       | Supported       |
| Offline viewer with scripts and network disabled                                              | Supported  | Not implemented | Not implemented |
| Links Notation export (`writeTraceLinks`) and incremental `links` sink                        | Supported  | Not implemented | Not implemented |
| `trace: 'retain-on-failure'` in `browser-commander/tests`                                     | Supported  | No test runner  | No test runner  |

Recording is JavaScript-only today; Python and Rust are readers, which is what
the bundle format exists for. `python/src/browser_commander/traces/` and
`rust/src/traces/` open the same directory a JavaScript run produced, and
`experiments/trace-cross-language-read.mjs` reads one bundle from all three to
prove it.

The Links Notation export (issue #94) is written by the recorder's language for
the same reason: it is a view of a bundle, and adding a notation dependency to
the two readers would buy nothing a reader cannot already do. Portability is a
property of the emitted file rather than of the writer - `links-notation` 0.20
exists for JavaScript, Python and Rust, and
`experiments/trace-links-export.mjs` parses a JavaScript-written export with
the Python implementation, streaming it in chunks, to prove the file is not
private to its writer.

## Launch Command Line and Opt-In Restrictions

By default `launchBrowser()`/`launch_browser()` starts the installed browser the
way a person would, then attaches to it (issue #103). The whole command line is:

```
<chrome> --user-data-dir=<fresh temporary profile> --remote-debugging-port=<reserved loopback port> about:blank
```

| Property         | Default                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Launch mode      | `launch: 'real'`: Browser Commander spawns the browser itself and attaches over CDP. `launch: 'engine'` keeps the engine launcher (`launchPersistentContext`/`puppeteer.launch`).                                                                                                                                                                                                                      |
| Browser          | The installed Chrome (or `channel`/`executablePath`); the engine's downloaded Chromium only when no installed browser is found.                                                                                                                                                                                                                                                                        |
| Profile          | A fresh temporary directory, deleted on close. Pass `userDataDir` to keep one.                                                                                                                                                                                                                                                                                                                         |
| First-run UI     | Suppressed by the `First Run` sentinel and `{"browser":{"last_whats_new_version":9999},"fre":{"has_user_seen_fre":true}}` in `Local State` - the files the browser writes itself - instead of `--no-first-run`. Without `last_whats_new_version` a "What's new" tab steals the foreground after attaching; without `fre.has_user_seen_fre` Microsoft Edge opens its edge://welcome-edge first-run tab. |
| Start page       | `about:blank`, unless `args` contain a URL. With no URL Edge opens edge://welcome-new-profile, whose flow closes the window and ends the browser seconds after the launch; Playwright and Puppeteer open `about:blank` for the same reason. A page cannot see how its tab was first opened.                                                                                                            |
| Remote debugging | A fixed, reserved loopback port. Port `0`, `--remote-debugging-pipe` and `--enable-automation` turn Blink's `AutomationControlled` feature on (so `navigator.webdriver === true`); a fixed port does not, and neither does `--headless` (a hand-started headless Chrome reports `false`), so `headless: true` adds only `--headless=new`.                                                              |
| Port ownership   | The browser's own `DevTools listening on ws://127.0.0.1:<port>/...` line must match `/json/version`, so a port lost to a race is detected and the launch retried with a new port.                                                                                                                                                                                                                      |
| Added switches   | None. `--remote-debugging-address` is not passed: DevTools binds to loopback by default.                                                                                                                                                                                                                                                                                                               |
| Host environment | Never modified. Restriction environment variables reach the browser process only.                                                                                                                                                                                                                                                                                                                      |
| `slowMo`         | `0`.                                                                                                                                                                                                                                                                                                                                                                                                   |

Everything Browser Commander used to add on its own is now a named, opt-in
restriction from `launch-restrictions.json` (shared byte-for-byte by
JavaScript, Python and Rust):

```js
await launchBrowser({ restrictions: ['no-sync', 'no-translate'] });
await launchBrowser({ restrictions: ['legacy-defaults'] }); // the pre-#103 CHROME_ARGS
```

| Restriction                | Effect                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `no-first-run`             | `--no-first-run` instead of the sentinel file.                                          |
| `no-default-browser-check` | `--no-default-browser-check`.                                                           |
| `no-crash-restore`         | `--disable-session-crashed-bubble --hide-crash-restore-bubble --disable-crash-restore`. |
| `no-infobars`              | `--disable-infobars` (ignored by current Chrome).                                       |
| `basic-password-store`     | `--password-store=basic`; real-profile data can no longer be decrypted or migrated.     |
| `mock-keychain`            | `--use-mock-keychain`; same caveat on macOS.                                            |
| `no-extensions`            | Disables extensions, background component extensions and default apps.                  |
| `no-sync`                  | `--disable-sync`.                                                                       |
| `no-google-services`       | `GOOGLE_API_KEY`/`GOOGLE_DEFAULT_CLIENT_*` = `no` for the browser process only.         |
| `no-translate`             | `--disable-features=Translate`.                                                         |
| `no-component-update`      | `--disable-component-update`.                                                           |
| `no-background-networking` | `--disable-background-networking`.                                                      |
| `no-popup-blocking`        | `--disable-popup-blocking`.                                                             |
| `no-phishing-detection`    | `--disable-client-side-phishing-detection`.                                             |
| `no-https-upgrades`        | `--disable-features=HttpsUpgrades`.                                                     |
| `no-media-router`          | `--disable-features=MediaRouter,DialMediaRouteProvider,GlobalMediaControls`.            |
| `no-lens`                  | `--disable-features=LensOverlay`.                                                       |
| `no-background-throttling` | Keeps hidden tabs at full speed.                                                        |
| `no-back-forward-cache`    | `--disable-back-forward-cache`.                                                         |
| `srgb-color-profile`       | `--force-color-profile=srgb`.                                                           |
| `start-maximized`          | `--start-maximized`.                                                                    |

Presets: `legacy-defaults` (the old `CHROME_ARGS`) and `legacy-launch-browser`
(the old `launchBrowser()` defaults, including the Google API key override and
`Translate`). Repeated `--disable-features`/`--enable-features` switches from
restrictions and `args` are merged into one, because Chrome honours only the
last occurrence.

`args`/`extraArgs` (`extra_args` in Python, builder methods in Rust) still
append switches. In `launch: 'engine'` mode, `ignoreDefaultArgs` removes
switches the engine itself adds, and `--disable-blink-features=AutomationControlled`
is added only while `automationParity` is on; that switch shows Chrome's
unsupported-command-line-flag infobar, which is why the real launch is the
default. The switches the real launch manages - `--user-data-dir`,
`--remote-debugging-port`, `--remote-debugging-address` and
`--remote-debugging-pipe` - cannot be overridden; Chrome 136+ refuses remote
debugging on its default profile.

`connectBrowser()`/`connect_browser()` only attaches to an existing process;
it cannot change that process's command line. Start an externally managed
browser with a dedicated profile and a fixed `--remote-debugging-port`, or
let `launchBrowser()` start it for you.

## CLI, `serve --stdio` Bridge, `cdpSession` and command-stream

Issue #104 gives every language one `browser-commander` command with the same
commands and output. The contract is [cli-and-bridge.md](cli-and-bridge.md).

| Feature                                              | JavaScript                                                                                           |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `browser-commander` CLI                              | `bin` in the npm package. Each command prints one JSON document and exits `0`/`1`/`2`/`64`.          |
| `run <script.json>`                                  | Same dispatcher as `serve`. Handle and session ids are deterministic (`h1`…, `s1`…, `e1`…).          |
| `serve --stdio` high-level methods                   | `session.*`, `page.*`, `trace.*`, `cookies.import`, `profile.migrate`, `open`, `doctor`, `version`   |
| `serve --stdio` generic handles                      | `handle.root/call/get/dispose/describe`, `events.subscribe/unsubscribe`, `events.emit`               |
| Full engine API through handles                      | Checked against the Playwright and Puppeteer `.d.ts` files (`npm run test:e2e:api-coverage`)         |
| `cdpSession` (`send`, `on`, `once`, `off`, `detach`) | `createCdpSession(page)` / `commander.createCdpSession()` for Playwright and Puppeteer               |
| Subprocesses through command-stream                  | The real-browser launch and the cookie credential tools (`security`, `secret-tool`, `kwallet-query`) |

The cross-language contract lives in `tests/cli-contract/`. `basic.json` runs
through each CLI, `normalize.mjs` removes the values that differ between
machines, and the output must equal `basic.expected.json`. The JavaScript CLI
runs it against a real Chrome in the `cli` job of the Browser Parity workflow.

`serve --stdio` replaces the 27-operation `node_engine_bridge.js` the Rust
crate used for Playwright and Puppeteer. The mapping is in
[cli-and-bridge.md](cli-and-bridge.md#replacing-the-27-operation-bridge).
Engine types that the API coverage suite does not reach from a fresh page
(for example `Route`, `Dialog`, `Download`, `Worker`) are still callable
through handles, but no test checks them yet.

## Compatibility Notes

- Existing Rust aliases remain compatible: `chromiumoxide` and `cdp` parse as `EngineType::Chromiumoxide`; `fantoccini` and `webdriver` parse as `EngineType::Fantoccini`.
- `playwright` and `puppeteer` now parse as distinct Rust engine types instead of silently mapping to a different backend.
- Rust Playwright/Puppeteer support requires Node.js plus the matching package in `node_working_dir` or normal Node module resolution.
- Python exposes the same CDP attach operation as `connect_browser()` for its Playwright and Selenium engines.
- Chrome 136 and newer require a non-default user data directory before honoring remote-debugging switches.
