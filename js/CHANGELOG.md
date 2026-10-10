# Changelog

## 0.28.0

### Minor Changes

- cc2a209: Add portable screenshots, bounded recordings and GIF/APNG/WebP encoding, trace
  rendering and summaries, full/text DOM links, bounded redacted network/HAR,
  continuous trace rotation/gzip, and detached reusable browser sessions with idle
  shutdown. Add early trigger readiness, explicit trigger concurrency, visible
  counts and configured overlay dismissal. Fix navigation-interrupted waits,
  Trusted Types capture, Chrome panel restrictions and deterministic tab selection.
  Close ordinary launched CLI browsers even when their connection supports detach;
  only explicitly kept-open sessions survive dispatcher cleanup.
  Add stable viewport capture with native-view CDP, viewport-only engine fallbacks
  and displayed-window regression coverage; document full-page compositor effects.
  Preserve readiness timer expiry when the rounded clock still reports budget.

## 0.27.0

### Minor Changes

- fab33b3: Honor per-call navigation policies, deadlines and cancellation; expose bounded redacted launch diagnostics. Add reusable indexed controls, ordered selectors/text, removable subscriptions and non-clearing flags. Add cookie-only browser reads, runtime cookies, session discovery and dedicated-profile persistence. Make SQLite optional, align links-notation 0.23, and document Bun CDP compatibility.

## 0.26.3

### Patch Changes

- 796ebd8: Accept dedicated macOS application profiles under `~/Library/Application Support` by separating Safari import discovery roots from protected browser data paths. Safari, Technology Preview and Chrome default profiles remain protected.

## 0.26.2

### Patch Changes

- e2ef59f: Verify crates.io trusted publishing before releases and mark repository fixture manifests as non-publishable. Document the account setup required for PyPI and crates.io.

## 0.26.1

### Patch Changes

- f2988a3: Close the parity probe server only after it stops listening, so a connection
  that arrives during shutdown can no longer keep `close()` waiting. Test fixture
  servers now drop idle browser preconnections too, which stopped the Safari
  smoke test from timing out during cleanup on Node 24.

  Parse Playwright `:has-text("…")` and `:text-is("…")` selectors with string
  operations instead of a backtracking regular expression. A long selector that
  did not match took quadratic time (16 seconds for 550,000 characters); it is
  now rejected in linear time. CodeQL reported it as `js/polynomial-redos`.

  Failure artifact names are trimmed of leading and trailing dashes by index, so
  a test name with a long run of dashes no longer takes quadratic time.

  A Safari launch right after a previous Safari session closed starts a fresh
  `safaridriver`, up to three attempts, when the driver exits before it is ready
  or refuses the connection. safaridriver serves one automation session at a
  time, and CI saw both failures on back-to-back launches. A refused connection
  now also names the driver server and whether it had exited. Authorization
  errors are still reported at once. Set `VERBOSE=1` to log each retry.

## 0.26.0

### Minor Changes

- 8f9ef1c: Add native Safari and Technology Preview W3C WebDriver control through real/common launchers and CLI, with isolated cookie seeding, setup diagnostics and typed unsupported feature errors.

  Update the transitive shell-quote lock entry to fix GHSA-pqg4-j6r4-53mv and unblock npm audit.

## 0.25.0

### Minor Changes

- 4a79d62: Import Safari bookmarks, history and explicit Passwords CSV exports into Chromium profiles. Discover named Safari profiles and modern WebKit cookie stores. Derive desktop browser executable discovery and profile protection from the shared catalogue, fix Opera Local State lookup, and report Yandex Ya Passman encryption limitations. Enforce domain boundaries for migrated cookies, history and passwords, and validate migration paths and options before writing.

  Resolve native Safe Storage credentials from the catalogue and provide service-specific macOS Keychain retry guidance. SQLite stores that cannot be backed up consistently return close-browser/retry guidance instead of copying live database files.

  Match exact hosts and subdomains in cookie-source metadata and automatic source selection, without decoding cookie values or treating domain strings as SQL wildcard patterns.

  Keep Safari profile-catalogue errors alongside readable profiles and cookie sources, including domain-filtered listings.

  Filter associated Login Data notes, security records and origin statistics; re-encrypt retained notes with the target key. Reset copied sync state and report unknown metadata omitted during domain-filtered imports.

  Recognize all 18 migration data classes with explicit unsupported reports. Add separate payment-card consent across native APIs, pre-launch migration, CLI and command streams, plus provider-specific passkey and certificate export limitations without accessing protected stores.

  Translate Firefox history to Chromium with exact microsecond visit dates, domain filtering, immutable snapshots and per-visit malformed-data reports.

  Normalize Firefox schema 16+ cookie expiry from milliseconds to seconds in both installed-profile reading and migration, preserving legacy schemas and session markers.

  Preserve supported Yandex Login Data imports when an unsupported Ya Passman Data store is present, retaining separate encryption diagnostics.

  Omit derived cluster labels, keywords, duplicate-visit records and unknown History metadata with named warnings during domain-filtered imports; preserve them during unfiltered imports.

## 0.24.0

### Minor Changes

- 31d2387: Support Selenium through the common launch, connection, CLI, and browser-test
  APIs, including raw WebDriver handles and generic engine constructors. Refresh
  all direct dependencies and generated engine APIs to the latest stable releases.

## 0.23.0

### Minor Changes

- b56775b: Add Safari and Safari Technology Preview cookie sources, including installed,
  default/auto and custom-directory import, counts-only domain discovery, validated
  binarycookies decoding and actionable Full Disk Access errors. Migration reports
  unsupported Safari classes and the SameSite Lax fallback. Other Safari stores,
  Firefox/WebKit targets, full clones and additional data classes remain tracked in
  issues #117–#120; this release does not claim full Safari profile import.

## 0.22.0

### Minor Changes

- f4ce84c: Add a shared catalogue of importable browsers and resolve the system default
  (#114).

  - `browser-sources.json` is a shared, data-driven catalogue of the browsers
    Browser Commander can import from — Chrome and its Beta/Dev/Canary channels,
    Edge channels, Brave variants, Chromium, Opera and Opera GX, Vivaldi, Arc,
    Yandex, and Firefox with its LibreWolf, Waterfox, Zen, Floorp, Developer
    Edition and Nightly forks. It records each browser's per-platform profile
    roots, Chromium Safe Storage identity, and operating-system default
    identifiers, and ships byte-identical to the Python and Rust packages.
  - `browser: 'default'` (or `'auto'`) now resolves the operating-system default
    web browser (macOS LaunchServices, Linux `xdg-settings`/`xdg-mime`, Windows
    `UserChoice` ProgId) to a catalogue id, so an import follows whichever
    browser a person actually uses.
  - Profile discovery and migration classify a browser's engine family from the
    catalogue instead of a hard-coded list, so every catalogued Chromium variant
    and Firefox fork is recognised, and reading cookies honours a custom
    `userDataDir`.
  - New `cookies sources` and `profile sources` commands (and the
    `cookies.sources`/`profile.sources` JSON-RPC methods) report which browsers
    and profiles hold cookies — optionally for specific `--domain`s — as names
    and counts only, never values.
  - A `default`/`auto` migration scoped to `domains` falls back from a default
    browser that holds no cookies for them to the installed profile holding the
    most, and reports which one with a `default-browser-fallback` warning
    (`resolveImportSource`). Migrating from Opera or Opera GX now reads their
    single profile from the user data directory itself.

## 0.21.2

### Patch Changes

- 917d611: Keep the real-browser launcher under the ESLint complexity limit, fail `npm run lint` on any warning, and record that `node-pty`'s install script (pulled in by `command-stream`) stays blocked.

## 0.21.1

### Patch Changes

- 4caa385: Suppress Chromium's default-browser prompt through profile settings on fresh and snapshot launches, and expose configurable Preferences and Local State values.

  Update the locked brace-expansion dependency to 5.0.12 to resolve its CPU and stack exhaustion advisories.

  Retry transient Windows credential-lock EPERM within the existing bounded deadline, preserving the underlying error when contention persists.

  Accept a `monotonic` clock in `startTrace` and use the injected `now` for interaction durations, so a trace recorded with a fixed clock is byte-for-byte reproducible; the Python and Rust recorders are checked against such a recording.

  Escape recorded text in the offline trace viewer. A recorded page's URL, title, form control values and event fields were inserted into the viewer as HTML, so a page could run script in the viewer of whoever opened its trace.

## 0.21.0

### Minor Changes

- 1d398f4: Run a real browser by default, measure parity, migrate profiles and drive
  every engine from one CLI (#101, #102, #103, #104, #105).

  Launch the installed browser the way a person would, and make every restriction
  opt-in (#101, #103).

  `launchBrowser()` now starts the installed Chrome (or `channel`/
  `executablePath`) itself and attaches over CDP. The whole command line is
  `--user-data-dir=<fresh temporary profile> --remote-debugging-port=<reserved
port> about:blank` (a URL in `args` replaces `about:blank`): no `--enable-automation`, no `--disable-blink-features`, so
  `navigator.webdriver` is `false` and Chrome shows neither the "controlled by
  automated test software" nor the unsupported-flag infobar. The temporary
  profile is seeded with the `First Run` sentinel and `Local State` entries that
  keep the "What's new" tab and Microsoft Edge's first-run tab from stealing the
  foreground, and it is deleted on close. `launch: 'engine'` keeps the Playwright/Puppeteer launcher.

  The debugging port is reserved on loopback and its ownership is proven from the
  browser's own `DevTools listening on` line, so a port lost to another process is
  detected and the launch retried on a new port. Subprocesses are started through
  `command-stream`.

  Everything the library used to add on its own - `CHROME_ARGS`, the Google API
  key override, the Translate preference, `--start-maximized` and `slowMo: 150` -
  is gone from the defaults and available as named `restrictions` from the shared
  `launch-restrictions.json` (`restrictions: ['legacy-defaults']` restores the old
  switches). The host `process.env` is never modified; restriction environment
  reaches the browser process only. `LAUNCH_MODES`, `LAUNCH_RESTRICTIONS`,
  `LAUNCH_RESTRICTION_PRESETS`, `resolveRestrictions`, `mergeFeatureSwitches`,
  `resolveLaunchExecutable`, the profile-directory helpers,
  `reserveLoopbackPort` and `PortRaceError` are exported.

  Measure how far a driven browser is from the same browser started by hand
  (#103).

  `measureParity()` starts the binary the way a person would, reads its
  chrome://version command line and runs the environment probe in it, then does
  the same for the browser Browser Commander launches (or for a `session` you
  pass). Every difference in the command line, in the feature switches and in
  anything a page can read is tagged with the limitations-catalogue entry that
  explains it or marked `requested` when it follows from an option you set; a
  report with an unexplained difference is not `ok`. `parseSwitches`,
  `compareCommandLines`, `classifyDifferences` and `readBrowserVersionPage` are
  exported too. The parity e2e suite measures every installed Chrome-family
  browser (Chrome, Chromium, Edge, Brave), headful and headless, through both
  engines.

  `--headless` is no longer treated as an AutomationControlled trigger, so a
  headless launch no longer adds `--disable-blink-features=AutomationControlled`:
  Chrome 153 keeps `navigator.webdriver` false for every `--headless` form, and
  the extra switch was the one difference `measureParity()` found headless.

  Add opt-in profile migration and a no-automation "open in the user's browser"
  mode (#102).

  The real-browser launch stays clean by default - so signing in with a Google
  account works (a nonexistent address shows "Couldn't find your Google Account",
  not "This browser or app may not be secure"). New APIs close the gap to the
  user's real browser:

  - `migrateProfile({ from, to, include, domains, targetBrowser })` copies data
    from an installed browser's main profile into a dedicated target profile. It
    is strictly read-only on the source: SQLite databases (`History`, `Top Sites`,
    cookies, Firefox `places.sqlite`) are copied through the SQLite Online Backup
    API so a running browser is never disturbed, and JSON (`Bookmarks`,
    `Preferences`) is copied as is. Data classes are `cookies`, `bookmarks`,
    `history`, `passwords`, `preferences` and `extensions` (`ALL_DATA_CLASSES`).
    Chromium passwords are re-encrypted with the target profile's OS-keystore key;
    Firefox uses its NSS `key4.db` path. The report explains what was skipped and
    why: DBSC-bound Google cookies (`dbsc-bound`), Windows app-bound `v20`
    (`app-bound-v20`), migrated extensions whose `Secure Preferences` MAC cannot be
    forged (`mac-will-not-validate`), and Firefox primary passwords
    (`primary-password-set`).
  - `launchRealBrowser({ migrateFrom })` runs that migration before launch, seeds
    the migrated cookies automatically, and returns a `migration` report on the
    session.
  - `openInUserBrowser(url)` opens a URL in the user's own default browser with no
    automation (macOS `open`, Linux `xdg-open`, Windows `explorer.exe`) for flows that
    only need to show a page, such as an OAuth or CLI web-login screen.

  `migrateProfile`, `ALL_DATA_CLASSES`, `openInUserBrowser`, `buildOpenCommand`
  and `validateOpenUrl` are exported.

  Add the `browser-commander` command line and its `serve --stdio` JSON-RPC
  bridge (#104).

  The package now installs a `browser-commander` binary. Its commands are
  `version`, `launch [--keep-open]`, `open`, `goto`, `click`, `fill`, `eval`,
  `screenshot`, `pdf`, `trace start|stop|view`, `cookies import`,
  `profile migrate`, `doctor`, `run <script.json>` and `serve --stdio`. Each
  command prints exactly one JSON document to stdout. It exits `0` on success,
  `1` on error, `2` when `doctor` finds an unlisted difference, and `64` on a
  usage error. Page commands either attach to a browser with `--cdp-endpoint` or
  launch a temporary one. The Rust and Python CLIs follow the same contract,
  `docs/cli-and-bridge.md`.

  `run` and `serve --stdio` share one dispatcher. It has the high-level methods
  (`session.launch`, `page.goto`, …) and generic handle methods
  (`handle.root`, `handle.call`, `handle.get`, `handle.describe`,
  `handle.dispose`, `events.subscribe`/`unsubscribe`). The handle methods reach
  every public Playwright and Puppeteer method, and an e2e suite checks this
  against the engines' shipped `.d.ts` files. Values that are not JSON are
  tagged (`$handle`, `$binary`, `$function`, `$date`, …), and handle ids are
  deterministic. The shared CLI contract checks equivalent results through all
  three language entry points. The Rust crate's existing 27-operation
  `node_engine_bridge.js` remains available for its typed adapter; callers can
  use the generic CLI bridge to reach methods beyond that adapter.

  `createCdpSession(page)` and `commander.createCdpSession()` return one raw CDP
  surface (`send`, `on`, `once`, `off`, `detach`) for Playwright and Puppeteer
  pages. The cookie credential tools now run through `command-stream`, like the
  browser launch.

  Add a `selenium` engine that drives Chrome and Firefox over W3C WebDriver and
  WebDriver BiDi (#104).

  `selenium-webdriver` is an optional peer dependency. `makeBrowserCommander()`
  detects a selenium `WebDriver` and runs every commander operation through a
  Puppeteer-shaped `WebDriverPage` facade and a `SeleniumAdapter` that uses
  WebDriver's own Element Click, Element Clear and Element Send Keys. PDFs come
  from the W3C Print Page command; options it cannot honour (header/footer
  templates, `preferCSSPageSize`) are refused rather than dropped.

  `launchWebDriver({ browser, executablePath, driverPath, headless, userDataDir,
bidi })` finds a driver (`driverPath`, then `PATH`, then the Selenium Manager
  bundled with `selenium-webdriver`), starts it on a reserved loopback port, waits
  for `/status`, and opens a session with a temporary profile that `close()`
  removes. Chrome gets the real-browser command line and all 19 switches
  chromedriver would add on its own are excluded, so `navigator.webdriver` is
  `false` headful and headless (measured with Chrome and chromedriver 153).
  `connectWebDriver({ serverUrl, capabilities })` opens a session on a server that
  is already running.

  With `bidi: true` the session asks for `webSocketUrl`, and console, dialog,
  request and frame-navigation events, preload scripts and full-page screenshots
  work through WebDriver BiDi. The adapter adds `onConsoleMessage()`,
  `onNavigation()`, `onBidiEvent()` and `navigate()` helpers. Media emulation,
  fingerprint overrides and managed downloads need CDP and throw a clear error on
  this engine. Four new shared limitations (`webdriver-driver-launch-switches`,
  `webdriver-no-cdp-emulation`, `webdriver-classic-has-no-events`,
  `webdriver-print-options`) record the gaps for JavaScript, Python and Rust.

## 0.20.0

### Minor Changes

- Persist managed downloads from Playwright pages in non-default Chromium browser
  contexts. Browser Commander now resolves the page target's `browserContextId`
  and applies its staging directory to that context while retaining browser-wide
  download lifecycle events.

  Wait for a real quiet period before accepting staged download bytes, close unfinished trace bundles explicitly in tests, and move the supported Node.js floor to 22 with the maintained `better-sqlite3` fallback.

## 0.19.0

### Minor Changes

- 4401d63: Record traces continuously across navigation and live state, and export them as
  Links Notation.

  `startTrace({mode: 'continuous'})` now keeps recording when the page navigates,
  changes route or creates a frame: the observers are reinstalled from an init
  script that runs before the page's own code, so nothing that happens during a
  load is lost. What a person changes but the DOM does not show - typing,
  checking, selecting, focus and scroll - is recorded as semantic live-state
  records and applied on replay, child-list records carry the position a node was
  inserted at or removed from, and every record carries stable trace, browser
  context, page, navigation, frame and action identities. `initialCheckpoint` (on
  by default) captures the page before the first action so the first interval has
  a base to replay onto, and the viewer says what it is: a diagnostic replay of
  what was recorded, not a re-execution of the session.

  `writeTraceLinks(trace, './run.lino', {include})` writes a portable Links
  Notation view of a bundle, and `startTrace({links: {output}})` writes the same
  view incrementally as the run happens. One link per line: one per ordered
  timeline event with its sequence, time, kind, owner ids, actor, action, target
  and outcome; one per checkpoint naming its HTML, state and screenshot members by
  their path inside the bundle; one per control that changed between two
  checkpoints. Dropped and partial records are explicit, binary content is never
  duplicated, and redaction is whatever the bundle already decided. The JSON
  bundle stays authoritative - this is an adapter, not a replacement.

  A managed download whose CDP completion arrives before the file does is no
  longer reported as a missing file: the staged bytes are waited for, and a
  timeout or a genuinely missing file is still a failure rather than a path that
  does not exist.

## 0.18.0

### Minor Changes

- 0915dd8: Add managed downloads, portable traces and truthful click results.

  `downloads` is now accepted by `launchBrowser()`, `connectBrowser()` and
  `launchRealBrowser()`, and by `commander.configureDownloads()` on a browser you
  already have. The manager owns the file rather than the page: `capture()` starts
  listening before the action runs so a fast download cannot be missed, a caller
  can choose the saved name and have a bare UUID given the extension its content
  proves, and the file is still there after the context and the browser are gone.
  Failed and cancelled downloads report the failure instead of a path, and
  `browser-commander/tests` keeps captured files in the run's artifact directory.

  `startTrace()` records a session into a schema-versioned bundle - an ordered
  NDJSON timeline, named checkpoints with full HTML, live control state and frame
  metadata, and the DOM mutation batches between them - which `readTrace()`,
  `diffControlState()` and the offline `writeTraceViewer()` read back with scripts
  and network disabled. Redaction runs before anything is written, a truncated or
  interrupted run still produces a readable partial trace, and
  `browser-commander/tests` supports `trace: 'retain-on-failure'` in place of its
  own artifact mechanism.

  `clickElement()` now reports what was observed: `status` is `succeeded`,
  `failed`, `timed_out`, `interrupted` or `unverified`, `effect` is `confirmed`,
  `not-observed` or `contradicted`, and `evidence` carries the reason for both.
  The `clicked` and `verified` booleans remain and are derived conservatively, so
  a click that changed nothing is no longer reported as verified. `waitForReady()`
  composes URL, network, DOM, image and custom checks under one deadline and
  returns the same per-check evidence. `noAutoScroll` is deprecated in favour of
  the `scroll` axis; `scroll: 'none'` now fails with a `ScrollConstraintError` on
  engines that cannot click without scrolling instead of scrolling anyway.

## 0.17.2

### Patch Changes

- 539ae64: Recover a release push that lost the race to `main` instead of failing the run.

  The `main-writer` concurrency group serialises the three release jobs correctly,
  but `actions/checkout` checks out `github.sha`, so every writer after the first
  holds a tree one commit behind `main` and its push is rejected as
  non-fast-forward. Serialisation buys ordering, not freshness. Every push to
  `main` now rebases and retries — after classifying the rejection, because a
  GH006/GH013 ruleset rejection also prints "rejected" and can never be rebased
  away.

## 0.17.1

### Patch Changes

- 43708ff: Make the release scripts fail when the commands they run fail.

  `command-stream`'s `$` resolves rather than rejects on a non-zero exit, so every
  `try/catch` around it in the release scripts was dead code. `loadCommandStream()`
  now turns on `errexit`, the GitHub release tags are namespaced per language, and
  the release job checks the formatting of the commit it is about to push.

## 0.17.0

### Minor Changes

- Restore the release pipeline. `const { $ } = await use('command-stream')` returned `undefined` on the Node 24 the release jobs pin, because Node 23 added a synthetic `'module.exports'` named export for CommonJS namespaces that use-m's unwrapping does not recognise, so every JS and Rust release died on its first shell call with `TypeError: $ is not a function`. Dependencies now load through `scripts/use-module.mjs`, which detects that namespace shape and unwraps it. Manifest fields are read by TOML table through `scripts/read-manifest.mjs` instead of a line-anchored `grep`, which matched duplicate keys in other tables and wrote two lines into `$GITHUB_OUTPUT`. The duplication gate had `format` set to a reporter name, so jscpd scanned zero files and passed unconditionally; it now scans the tree against a recorded baseline.

  Add the `fingerprint` subsystem, which removes the differences between a browser this library controls and one started by hand. `navigator.webdriver` stays false because the `AutomationControlled` Blink feature is disabled at launch, and `launchBrowser()` no longer passes the engine defaults a real Chrome does not carry. `resolveFingerprintProfile()` validates the 19 environment fields a page can read -- user agent and client hints, languages and locale, time zone, platform, cores, memory, screen, viewport, touch, WebGL strings, geolocation and the media preferences -- `createFingerprintPreset()` builds internally consistent Windows, macOS, Linux and Android machines, and `applyFingerprint()` installs a profile over CDP for both Playwright and Puppeteer. `FINGERPRINT_LIMITATIONS` documents what still cannot be made identical, and `relevantFingerprintLimitations()` narrows it to the entries a given profile and browser actually hit. The excluded defaults include Playwright's unconditional `--enable-unsafe-swiftshader`, which would otherwise give an automated browser a SwiftShader WebGL context on a machine where a hand-started Chrome has none.

## 0.16.1

### Patch Changes

- 542bf75: Fix CI/CD false positives, false negatives and warnings across all workflows
  - Repair `if:` conditions that started with `!`, which a YAML plain scalar cannot do
  - Replace `always()` with `!cancelled()` so cancelled runs stop propagating
  - Gate `instant-release` and `changeset-pr` on lint and test, so a manual release can no longer publish unvalidated code
  - Make the changelog fragment checks fail instead of only warning
  - Pass `github.base_ref` and free-form `workflow_dispatch` inputs through environment variables instead of interpolating them into shell bodies
  - Update `actions/setup-python` to v6, `codecov/codecov-action` to v7 and `peter-evans/create-pull-request` to v8
  - Extend `scripts/check-ci-workflows.mjs` so each of the above becomes a permanent policy check
  - Add repository-wide secrets scanning and a 1500-line file limit gate

## 0.16.0

### Minor Changes

- a23c0fa: Add installed-browser profile discovery and privacy-preserving cookie import for Chrome, Edge, Brave, Chromium, and Firefox, including OS credential caching and Playwright/Puppeteer-compatible output.

## 0.15.0

### Minor Changes

- b3560c8: Apply automation-friendly Chromium launch defaults, including `--password-store=basic`, and add append/opt-out launch argument controls.

## 0.14.0

### Minor Changes

- d22b80e: Add the `launchRealBrowser()` API name for launching and attaching to a genuine installed Chrome-family browser.

## 0.13.0

### Minor Changes

- 46d0049: Add CDP attachment through `connectBrowser()` for Playwright and Puppeteer, plus `launchAndConnectRealBrowser()` for starting an installed Chrome-family browser with a dedicated automation profile.

## 0.12.0

### Minor Changes

- Add `commander.setContent()` for safely loading in-memory HTML through the managed navigation lifecycle.

  Add portable cookie and localStorage restoration through `launchBrowser({ storageState })` and the `saveStorageState()` helper for Playwright and Puppeteer.

  Avoid intermittent Node 24 test-runner transport failures on macOS by running test files without child-process isolation.

## 0.11.0

### Minor Changes

- 8ef86eb: Add page HTML, rendered text, and positional page evaluation APIs to commander instances.

## 0.10.0

### Minor Changes

- fe688ac: Add `channel` and `executablePath` launch options for reusing an installed Chrome-family browser.

## 0.9.1

### Patch Changes

- cbd4fe1: Remove CI warning noise from workflow actions, release logging, and lint output.

## 0.9.0

### Minor Changes

- 21c63ac: Add the `browser-commander/tests` export with `test-anywhere`-based browser
  test helpers for Playwright and Puppeteer, duration-aware ordering, balanced
  shard planning, retries, timeouts, and failure artifacts.

## 0.8.1

### Patch Changes

- ffc59e6: Add generated JSDoc API documentation support for the JavaScript package.

## 0.8.0

### Minor Changes

- a681a87: Add unified `page.pdf(options)` method to `EngineAdapter`, `PlaywrightAdapter`, and `PuppeteerAdapter`, eliminating the need for users to access raw page objects via the `page._page || page` workaround. The `pdf()` method is also exposed on the `BrowserCommander` facade via `commander.pdf({ pdfOptions })`.

## 0.7.0

### Minor Changes

- Add emulateMedia API for unified color scheme emulation across all engines

  Implements `emulateMedia({ colorScheme })` as a unified API for color scheme emulation (prefers-color-scheme) across Playwright and Puppeteer engines. Also adds `colorScheme` as a launch option to `launchBrowser`.

  Fixes #36

- 785eb13: Add unified dialog event handling API (`page.on('dialog', handler)`)
  - New `DialogManager` (`core/dialog-manager.js`) that registers `page.on('dialog')` for both Playwright and Puppeteer
  - `commander.onDialog(handler)` — register a handler for browser dialogs (alert, confirm, prompt, beforeunload)
  - `commander.offDialog(handler)` — remove a previously registered handler
  - `commander.clearDialogHandlers()` — remove all dialog handlers
  - Auto-dismiss behavior when no handlers are registered (prevents page from freezing)
  - `enableDialogManager` option (default: `true`) to opt out if needed
  - Exports `createDialogManager` for low-level usage
  - 19 new unit tests covering all dialog handling scenarios

- 80ec5f7: Add page-level keyboard interaction support (issue #37)

  Expose keyboard input methods on the commander object, enabling users to press
  keys, type text, and hold modifier keys without accessing the raw page object
  directly. New API: `commander.keyboard.press()`, `commander.keyboard.type()`,
  `commander.keyboard.down()`, `commander.keyboard.up()`, and flat aliases
  `commander.pressKey()`, `commander.typeText()`, `commander.keyDown()`,
  `commander.keyUp()`.

## 0.6.0

### Minor Changes

- 7d83530: Document extensibility escape hatch: `commander.page` and `launchBrowser()` return values expose the raw underlying Playwright/Puppeteer page object as an official mechanism for accessing engine-specific APIs not yet supported by browser-commander (e.g. `page.pdf()`, `page.emulateMedia()`, `page.keyboard`, `page.on('dialog', ...)`). Adds tests verifying `commander.page` is the exact raw page object.

## 0.5.4

### Patch Changes

- e9043cc: Fix normalizeSelector to validate input type and reject arrays

  When `normalizeSelector` receives an invalid type (array, number, or non-text-selector object), it now returns `null` with a warning instead of returning the invalid value unchanged.

  This prevents downstream `querySelectorAll` errors with invalid selector syntax (like trailing commas when arrays are accidentally passed).

  Fixes #23

## 0.5.3

### Patch Changes

- 8b86dd7: Include README.md in npm package

  Added language-specific README.md files for each implementation:
  - js/README.md: JavaScript/npm-specific documentation with installation and API usage
  - rust/README.md: Rust/Cargo-specific documentation
  - Root README.md: Common overview linking to both implementations

  The npm package now includes the JavaScript-specific README.md directly from the js/ directory.

## 0.5.2

### Patch Changes

- 87224ee: Fix package.json path in version-and-commit.mjs for monorepo structure

  The git show command uses repository root paths, not the workflow's working directory. Since this is a monorepo with js/ and rust/ folders, the path must be js/package.json instead of just package.json.

  This was causing "Unexpected end of JSON input" errors when the script tried to read package.json from the repository root (which doesn't exist) instead of js/package.json.

## 0.5.1

### Patch Changes

- 2b22f43: Fix PlaywrightAdapter.evaluateOnPage() to spread multiple arguments correctly

  When using `evaluateOnPage()` with multiple arguments, the arguments are now properly spread to the function in the browser context, matching Puppeteer's behavior.

  Previously, the function would receive the entire array as its first parameter instead of spread arguments, causing issues like invalid selectors when passing selector + array combinations.

## 0.5.0

### Minor Changes

- adfccde: Add Rust implementation with parallel JavaScript codebase reorganization

  This introduces a complete Rust translation of the browser-commander library alongside the existing JavaScript implementation. The codebase is now organized into two parallel structures:
  - `js/` - JavaScript implementation (all existing functionality preserved)
  - `rust/` - New Rust implementation with the same modular architecture

  Key features of the Rust implementation:
  - Unified API across multiple browser engines (chromiumoxide, fantoccini)
  - Core types and traits (constants, engine adapter, logger)
  - Element operations (selectors, visibility, content)
  - User interactions (click, scroll, fill)
  - Browser management (launcher, navigation)
  - General utilities (URL handling, wait operations)
  - High-level DRY utilities
  - Comprehensive test coverage with 106 tests

## 0.4.0

### Minor Changes

- 5af2479: Add support for custom Chrome args in launchBrowser

  Adds a new `args` option to the `launchBrowser` function that allows passing custom Chrome arguments to append to the default `CHROME_ARGS`. This is useful for headless server environments (Docker, CI/CD) that require additional flags like `--no-sandbox`, `--disable-setuid-sandbox`, or `--disable-dev-shm-usage`.

  Usage example:

  ```javascript
  import { launchBrowser } from 'browser-commander';

  const { browser, page } = await launchBrowser({
    engine: 'puppeteer',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  ```

  Fixes #11

## 0.3.0

### Minor Changes

- 03e9ccb: Add isTimeoutError function for detecting timeout errors

  Adds a new `isTimeoutError` function exported from the library that helps detect timeout errors from selector waiting operations. This function is complementary to `isNavigationError` and allows automation loops to handle timeout errors gracefully without crashing.

  Usage example:

  ```javascript
  import { isTimeoutError } from 'browser-commander';

  try {
    await page.waitForSelector('.button');
  } catch (error) {
    if (isTimeoutError(error)) {
      console.log('Timeout occurred, continuing with next item...');
    }
  }
  ```

## 0.2.1

### Patch Changes

- Test patch release

## 0.2.0

### Minor Changes

- 5690786: Add Playwright text selector support and use TIMING constants
  - Add `isPlaywrightTextSelector()` and `parsePlaywrightTextSelector()` functions
  - Update `normalizeSelector()` to convert Playwright text selectors (`:has-text()`, `:text-is()`) to valid CSS selectors
  - Update `withTextSelectorSupport()` to handle both Puppeteer and Playwright text selectors
  - Add `NAVIGATION_TIMEOUT` constant and use it in navigation-manager

## 0.1.1

### Patch Changes

- 3e0a56b: Add CI workflow and development best practices
  - Add GitHub Actions workflow for tests on push and PRs
  - Add changeset configuration for version management
  - Add Prettier for code formatting
  - Add ESLint with Prettier integration
  - Add jscpd for code duplication detection
  - Add Husky pre-commit hooks
  - Add release scripts for automated publishing

All notable changes to this project will be documented in this file.

## 0.1.0

### Minor Changes

- Initial release of browser-commander with unified Playwright and Puppeteer API
