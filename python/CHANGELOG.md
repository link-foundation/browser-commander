
<a id='changelog-0.5.4'></a>
## 0.5.4 — 2026-11-15

- Added Playwright-compatible cookie and localStorage import and export for Python Playwright and Selenium launches and CDP connections.
- Added native `snapshot_user_data_dir` and `launch_snapshot` for selected live Chromium profiles, with SQLite WAL backup, exclusion reports, and owned-copy cleanup for Playwright and Selenium. Live database locks fall back to file copies after a bounded retry.
- Added a native typed extension relay with tab operations, CDP sessions/events, origin and extension-ID checks, bounded requests, cancellation cleanup, and the bundled companion extension. Install the optional `extension` extra.
- Added typed Puppeteer from Python: `browser_commander.puppeteer` drives Puppeteer through the JavaScript CLI's `serve --stdio` bridge. Every Puppeteer class and interface has a Python class in the same hierarchy, with an `async def` for every method and getter, generated from puppeteer-core's `lib/types.d.ts`.
- Added native trace recording: `BrowserCommander.start_trace()` (and `browser_commander.traces.start_trace`) writes the same portable trace bundle as JavaScript, with checkpoints, continuous DOM mutation batches, one ordered timeline of navigations, interactions, console messages, page errors, failed requests, dialogs and downloads, redaction, size limits, and a streamed Links Notation export. `write_trace_viewer`/`render_trace_viewer` produce the same offline viewer and `trace_links`/`write_trace_links` the same `.lino` export, checked byte-for-byte against the JavaScript recorder's golden trace. `traced()` gives retain-on-failure without a test runner: an `async with` block that raises keeps its bundle with a `failure` checkpoint and the offline viewer, and one that returns leaves nothing. `DialogManager.observe_dialogs()` lets a recorder watch dialogs without taking over dismissal.

---
bump: patch
---

CI/CD: crates.io publishing tries trusted publishing (OIDC) first and falls back to the CARGO_REGISTRY_TOKEN / CARGO_TOKEN secret when it is unavailable. The release preflight verifies that fallback token with a publish request that omits the archive, so a release is blocked only when neither credential can publish.

### Added

- `open_in_user_browser(url)` hands a URL to the operating system's default
  browser with no automation (`open` on macOS, `xdg-open` on Linux,
  `explorer.exe` on Windows), through `run_command` with exact argv
  boundaries and no shell. `validate_open_url()` refuses URLs that start with
  `-` or use a scheme a browser would not open, and `build_open_command()`
  returns the exact opener argv.
- `migrate_profile(from_=..., to=...)` migrates a real Chrome, Chromium,
  Brave, Edge or Firefox profile into a dedicated automation profile:
  cookies, bookmarks, history, passwords, preferences and extensions
  (`ALL_DATA_CLASSES`). Databases are read through a consistent read-only
  SQLite snapshot, so the source browser may stay open. Chromium passwords
  are decrypted with the source OSCrypt key and re-encrypted for the target;
  Firefox bookmarks and logins are translated into the Chromium formats.
  Device-bound (DBSC) cookies, app-bound (`v20`) passwords and policy or
  component extensions are skipped, and the report says why.
- `launch_real_browser(RealBrowserOptions(migrate_from=...))` migrates a
  profile into `<user_data_dir>/Default` before the browser starts, seeds the
  migrated cookies over CDP and exposes the report as `result.migration`.
- `measure_parity()` compares a driven browser with the same binary started
  by hand (command line, feature switches and everything the environment
  probe reads) and classifies every difference against the fingerprint
  limitations catalogue, returning the JavaScript-compatible parity report.
  `parse_switches()`, `compare_command_lines()`, `classify_differences()` and
  `read_browser_version_page()` are exported too, and
  `browser_commander.parity` ships the probe, its server and the reference
  capture.

- A `browser-commander` console script with the shared JSON command and
  `serve --stdio` protocols. It runs the companion JavaScript CLI for browser
  commands, so Playwright and Puppeteer handles can be reached through one
  interface; `version` reports the Python package version locally.
- Read-only profile migration, opt-in migration during a real-browser launch,
  and `open_in_user_browser()` for a plain URL hand-off. The migration report
  records data that cannot be copied or decrypted.
- `browser_commander.utilities.subprocess` runs child processes without a
  shell, mirroring the `command-stream` interface used by the JavaScript and
  Rust packages: `run_command()`/`run_command_sync()` return
  `CommandResult(stdout, stderr, code)` and raise `CommandError` (a
  `subprocess.CalledProcessError`) on failure, and `start_process()` returns a
  `ManagedProcess` with output listeners, an `exit` listener, `wait()` and a
  `kill()` that escalates from SIGTERM to SIGKILL. The browser launch and the
  cookie-import credential helpers use it.
- New exports: `LAUNCH_MODES`, `LAUNCH_RESTRICTIONS`,
  `LAUNCH_RESTRICTION_PRESETS`, `resolve_restrictions`,
  `merge_feature_switches`, `browser_environment`,
  `resolve_launch_executable`, `create_temporary_user_data_dir`,
  `prepare_user_data_dir`, `remove_user_data_dir`, `reserve_loopback_port`,
  `assert_fixed_debugging_port`, `build_real_browser_args`,
  `pick_foreground_page`, `PortRaceError`, `CommandError`, `ManagedProcess`,
  `run_command` and `start_process`.

- A shared, data-driven catalogue of importable browsers
  (`browser-sources.json`, byte-identical across the JavaScript, Python and
  Rust packages) covering Chrome and its Beta/Dev/Canary channels, Edge
  channels, Brave variants, Chromium, Opera and Opera GX, Vivaldi, Arc, Yandex,
  and Firefox with its LibreWolf, Waterfox, Zen, Floorp, Developer Edition and
  Nightly forks. It records each browser's per-platform profile roots, Chromium
  Safe Storage identity, and operating-system default identifiers.
- `browser="default"` (or `"auto"`) resolves the operating-system default web
  browser (macOS LaunchServices, Linux `xdg-settings`/`xdg-mime`, Windows
  `UserChoice` ProgId) to a catalogue id.
- Profile discovery and migration classify a browser's engine family from the
  catalogue, so every catalogued Chromium variant and Firefox fork is
  recognised, and reading cookies honours a custom user-data directory.
- `list_cookie_sources()` and `list_browser_profiles()` report which browsers
  and profiles hold cookies — optionally for specific domains — as names and
  counts only, never values.
- A `default`/`auto` migration scoped to `domains` falls back from a default
  browser that holds no cookies for them to the installed profile holding the
  most, and reports which one with a `default-browser-fallback` warning
  (`resolve_import_source()`, `migrate_profile(run_command=...)`). Migrating
  from Opera or Opera GX now reads their single profile from the user data
  directory itself.

- Safari and Safari Technology Preview cookie import with installed/default/custom
  discovery, domain counts without decoding values, validated binarycookies decoding
  and Full Disk Access diagnostics. Native options and reports match JS and Rust.
  Unsupported Safari classes and unavailable SameSite are reported explicitly.
  Remaining profile import requirements are tracked in issues #117–#120.

- Native Safari bookmark/history and explicit Passwords CSV import into Chromium, named Safari profile discovery and modern WebKit cookie-store preference.
- Catalogue-derived desktop executable discovery and profile protection, Opera Local State resolution, and specific Yandex Ya Passman encryption reports.
- Migration option/path validation and domain isolation for cookies, history, downloads embedded in History, and passwords.
- Catalogue-derived Safe Storage credentials and service-specific macOS Keychain retry guidance. Locked SQLite stores require a consistent backup instead of a live-file copy fallback.
- Exact host/subdomain metadata counts and automatic cookie-source selection, without decoding values or SQL wildcard matching.
- Safari profile-catalogue errors retained alongside readable profiles and cookie sources, including domain-filtered listings.
- Login Data note/security associations and origin statistics filtered, retained notes re-encrypted with target keys, copied sync state reset, and unknown metadata omitted with warnings during domain-filtered imports.
- All 18 data-class selections and zero-count unsupported reports, separate boolean payment-card consent, and provider-specific passkey/certificate export limitations without accessing protected stores.
- Firefox history translated to Chromium with exact microsecond visit dates, domain filtering, immutable snapshots and per-visit malformed-data reports.
- Firefox schema 16+ cookie expiry normalized from milliseconds to seconds in installed-profile reading and migration, preserving legacy schemas and session markers.
- Supported Yandex Login Data imports preserved beside unsupported Ya Passman Data, with separate encryption diagnostics.
- Derived clusters, keywords, duplicate visits and unknown History metadata omitted with named warnings during domain-filtered imports, and preserved during unfiltered imports.

- Native Selenium PDF printing through the common commander API, with portable
  paper/margin options and explicit errors for unsupported WebDriver options.
- Real-browser coverage for each native engine and launch mode, and Selenium
  support through the optional shared CLI.

- Safari and Technology Preview Selenium control through real/common launchers, isolated cookie seeding, Remote Automation setup diagnostics and typed unsupported feature errors.

- Reusable selector, text, indexed control, checkbox, flag and subscription APIs.
- Browser-backed cookie-only reads, runtime cookie management, session discovery,
  and explicit dedicated-profile session-cookie persistence.
- Structured, bounded and redacted launch diagnostics with caller redaction.

- Typed screenshots, bounded recordings and GIF/APNG/WebP encoding with Pillow.
- Stable native-view/viewport screenshot mode with viewport-only fallbacks.
- Full/text DOM links, redacted bounded network/HAR, navigation checkpoints,
  continuous trace rotation/gzip, debug presets and persistent browser sessions.
- Shared CLI capture/render commands, early trigger readiness, explicit trigger
  concurrency, visible counts and configured overlay dismissal.

- A launch with an explicit `user_data_dir` keeps session cookies (cookies
  without an expiry date, which most logins set) across a normal `close()` and
  relaunch (issue #187). Before, Chromium deleted them on every clean start, so
  a persistent profile lost its logins. The browser's own encrypted cookie
  store keeps them: Chromium launches with `--restore-last-session`, and the
  last session's tabs are deleted first so the launch still starts with one
  tab (`restore_tabs=True` reopens them). The Playwright engine launches the
  full Chromium build headless (`channel="chromium"`), because the headless
  shell cannot keep session cookies; Safari and an explicitly selected headless
  shell return a `keep_session_cookies` warning in `warnings`.
- Every entry point supports it: `launch_browser` with either engine and
  `launch` mode, `connect_or_launch`, `launch_real_browser` and the CLI
  (`--keep-session-cookies`, `--no-keep-session-cookies`, `--restore-tabs`).
  `keep_session_cookies=False` opts out, and temporary profiles behave as
  before. Launch results report `keep_session_cookies` and `warnings`. New
  exports: `persistent_profile_args()`, `clear_restored_tabs()`,
  `prepare_session_restore()`, `KEEP_SESSION_COOKIES_SWITCH`,
  `CONTINUE_SESSION_FEATURE`, `FIREFOX_KEEP_SESSION_COOKIES_PREFERENCES` and
  `SESSION_RESTORE_FILES`. The opt-in plaintext `persist_session_cookies` file
  is unchanged.

- Added managed downloads. `downloads` is accepted by `launch_browser()`, `connect_browser()` and `launch_real_browser()`, and by `commander.configure_downloads()` on a browser you already have. `capture()` starts listening before the action runs so a fast download cannot be missed, the caller chooses the saved name and a bare UUID is given the extension its content proves, and the file is still there after the context and the browser are gone. Failed and cancelled downloads report the failure instead of a path. Playwright uses a browser-wide CDP session so a download a person started by hand is managed too; Selenium, which has no download events, watches the staging directory.
- Added `browser_commander.traces`, which reads the schema-versioned trace bundles a JavaScript run records - manifest, ordered NDJSON timeline, checkpoint DOM snapshots and mutation batches - and diffs checkpoint control state. Recording is not implemented in Python yet, and `docs/feature-parity.md` says so.

- `browser_commander.traces` reads trace schema version 2: the mutation kinds a continuous recording writes, including the semantic live-state records for typing, checking, selecting, focus and scroll, the checkpoint reasons, and the replay-support flags a bundle declares. A bundle recorded by an older JavaScript run still reads, and one recorded by a newer schema is still refused rather than guessed at.

### Changed

- `LaunchOptions.launch` defaults to `"real"`; `launch="engine"` opts back into
  the Playwright or Selenium managed launch.
- A launch adds no Chrome switches of its own beyond `--user-data-dir` and
  `--remote-debugging-port`. The previous defaults are named restrictions that
  can be chosen with `LaunchOptions(restrictions=[...])`: see
  `LAUNCH_RESTRICTIONS`, `LAUNCH_RESTRICTION_PRESETS` and
  `resolve_restrictions()`. `restrictions=["legacy-defaults"]` restores the old
  `CHROME_ARGS`, which is kept as a legacy constant.
- A launch without `user_data_dir` uses a fresh temporary profile that is
  deleted when the browser closes or exits.
- The `GOOGLE_API_KEY`/`GOOGLE_DEFAULT_CLIENT_*` values of the
  `no-google-services` restriction are passed to the browser process only;
  `os.environ` is never changed.
- `slow_mo` defaults to `0`.
- `LaunchResult` gains `close()`, `launch`, `user_data_dir`,
  `temporary_profile`, `args`, `remote_debugging_port`, `cdp_endpoint`,
  `executable_path`, `browser_process` and `connected_browser`. `browser` and
  `page` keep their meaning.
- A real launch opens `about:blank` (`START_URL`), as Puppeteer and Playwright
  do, unless `args` contains a URL. Without a start URL Microsoft Edge opened
  its new-profile welcome flow, which closed the window and exited the browser
  a few seconds after launch.
- The fresh profile's `Local State` also records Edge's first run
  (`fre.has_user_seen_fre`), so `edge://welcome-edge/` does not take the
  foreground.
- `--headless` is no longer an AutomationControlled trigger, so a headless
  launch no longer adds `--disable-blink-features=AutomationControlled`: a
  hand-started headless Chrome 153 reports `navigator.webdriver` false.

- Upgrade all dependencies to their latest stable versions, retaining Python
  3.9 through interpreter-specific compatibility requirements.

- The typed Puppeteer bindings now describe puppeteer-core 25.12.0, the
  version the JavaScript package installs (`PUPPETEER_VERSION` was still
  25.10.0). The API is unchanged between the two versions.

- Commander trace interactions now include `source: "commander"`, keeping the portable trace conformance fixture consistent with JavaScript user-action recording.

- Launches without `channel` or `executable_path` start Chrome for Testing (Playwright's download, else the newest build in the `ms-playwright` cache; Selenium also tries the Puppeteer and Selenium Manager caches, then Selenium Manager) instead of the installed Google Chrome, which is now used only on request and never as a silent fallback. A Chrome for Testing launch gets the new `chrome-for-testing` restriction preset by default (`no-chrome-for-testing-infobar`, i.e. `--test-type=gpu`, and `mock-keychain`); pass `default_restrictions` to change it. New helpers: `is_chrome_for_testing`, `default_restrictions_for` and `CHROME_FOR_TESTING_RESTRICTIONS`.

- `click_element()` now reports what was observed rather than what was attempted: `status` is one of `succeeded`, `failed`, `timed_out`, `interrupted` or `unverified`, `effect` is `confirmed`, `not-observed` or `contradicted`, and `evidence` carries the reason for both. `clicked` and `verified` remain and are derived conservatively, so a click that changed nothing is no longer reported as verified. `wait_for_page_ready()` composes URL, network, DOM, image and custom checks under one deadline and returns the same per-check evidence.

### Deprecated

- `no_auto_scroll` is deprecated in favour of the `scroll` axis (`auto`, `preserve`, `none`). `scroll="none"` now fails with a `ScrollConstraintError` on engines that cannot click without scrolling, instead of scrolling the page anyway.

### Fixed

- `launch_browser()` now starts the installed Chrome as a normal process on a
  reserved fixed loopback port and attaches to it over CDP, so pages no longer
  see `navigator.webdriver === true`. The command line carries none of the
  switches that turn Blink's `AutomationControlled` on (`--enable-automation`,
  `--headless`, `--remote-debugging-pipe`, `--remote-debugging-port=0`); port
  `0` is refused. The browser has to prove it owns the port through its
  `DevTools listening on` line; losing the port to another process raises
  `PortRaceError`, and the launcher retries on a new port (up to three
  attempts) when the caller did not pick the port.
- Closing a real-browser launch now asks the browser to close over CDP, kills
  it when it does not exit, and stops the Playwright driver started for the
  CDP attachment instead of leaking it.

- Fresh real-browser launches seed Chromium's profile settings so the disposable window does not ask to become the system default browser. Callers can configure `default_browser_check`, `first_run`, `preferences`, and `local_state` without adding launch switches.

- `start_process` output callbacks decode UTF-8 incrementally, so a multi-byte character split across two reads is no longer replaced with U+FFFD.

- `click_button`, `fill_text_area`, `query_selector`, `wait_for_locator_or_element` and `is_enabled` work on a real Playwright page again. They called `Locator.first()`, which is a property in Python Playwright, so they raised `TypeError` (`is_enabled` swallowed it and reported every element as disabled). Simulated typing called `adapter.type()` instead of `type_text()`.

- Selenium now invokes JavaScript function probes and reads DOM textContent,
  fixing verified input/click operations and hidden-text reads.
- Browser exit and close await one shared temporary-profile cleanup, preventing
  concurrent deletion from returning before snapshot copies are removed.

- The Python test suite no longer leaks a sqlite3 connection (`ResourceWarning: unclosed database`). `with sqlite3.connect(...)` only commits or rolls back, it does not close, so the remaining test fixtures now wrap the connection in `contextlib.closing()`. pytest now turns `ResourceWarning` and unraisable-exception warnings into errors, so a future leak fails CI instead of hiding in the warnings summary.
- `parse_playwright_text_selector` splits `:has-text("…")` and `:text-is("…")` selectors with string operations instead of a backtracking regular expression, which took quadratic time on long selectors that did not match.
- A Safari launch right after a previous Safari session closed starts a fresh `safaridriver`, up to three attempts, when the driver exits before it is ready or refuses the connection. safaridriver serves one automation session at a time, and CI saw both failures on back-to-back launches. Authorization errors are still reported at once. Set `VERBOSE=1` to log each retry.

- Accept dedicated macOS application profiles under `~/Library/Application Support` by separating Safari import discovery roots from protected browser data paths. Safari, Technology Preview and Chrome default profiles remain protected.

- Honor managed per-call readiness policies, share navigation deadlines and
  distinguish cancellation from timeout and observed success.
- Resolve modern macOS default browsers and catalogue snapshot channels.

- Navigation-interrupted element waits, Trusted Types checkpoints, Chrome panel
  restrictions, protected-preference diagnostics and deterministic tab selection.
- Preserve readiness timer expiry when the rounded clock still reports budget.

- Redact structured request bodies, UTF-8 responses, hidden controls, HTML and mutations before persistence; bound mutation intervals and incremental links.
- Rotate continuous bundles at write boundaries while retaining segments and recorder behavior.
- Recover stale remembered targets and zero-page CDP connections with explicit no_defaults support and failure cleanup.
- Heartbeat attached persistent sessions and enforce subsequent tabs; preserve pending trigger starts and report overlay failures safely.

- Retain sanitized engine attachment failures alongside browser stderr in launch error messages.

- Preserve native Playwright text selectors and CSS sibling positions; use unique ancestor paths for Selenium text matches.

- Selenium starts or attaches to Chrome for Testing with the ChromeDriver of its own release (issue #179): a `chromedriver` on `PATH` belongs to the installed Google Chrome and refuses another release, yet Selenium Manager returns it even for a `--browser-path`, so it is now asked with `--skip-driver-in-path`. `ConnectOptions.executable_path` names the browser behind a Selenium `cdp_endpoint`, and the real-browser launch passes the browser it started.

- `migrate_from` re-encrypts passwords with the key of the browser that starts (issue #179): Chrome for Testing reads "Chromium Safe Storage", and with its default `mock-keychain` restriction (or `--password-store=basic` on Linux) Chromium's fixed mock password, so migrated passwords decrypt in it. macOS logins are written with the `v10` prefix Chromium uses there.

- `measure_parity` counts the switches of Chrome for Testing's default restrictions (`--test-type=gpu`, `--use-mock-keychain`) as requested rather than as unlisted extras (issue #179).

- Trace checkpoint screenshots and default screenshots of pages without a fixed viewport use CDP `Page.captureScreenshot` without a clip, so a headful window resized during a capture keeps its real size.

- Saved-password refreshes now preserve existing target logins and metadata,
  merge new identities idempotently, and remap imported password notes. Active
  targets, incompatible schemas, populated account stores and target-key
  mismatches refuse before publication, including Firefox/Safari writers.

- Prepared profiles keep Chrome 155's "Continue where you left off" session restore infobar closed by writing `browser.session_restore_infobar_times_shown` to the profile's `Preferences`.

- Managed Playwright downloads now apply the staging directory to the page's
  Chromium browser context, so pages created by `browser.new_page()` or
  `browser.new_context()` persist their downloads instead of timing out while
  waiting for a GUID file in the default context's directory.

- Retrying a failed Python publish no longer attempts to collect newer changelog fragments under a version that is already present in `CHANGELOG.md`.

<a id='changelog-0.5.3'></a>
## 0.5.3 — 2026-09-06

Add installed-browser profile discovery and local cookie import for Chromium-family browsers and Firefox, with owner-only cross-process credential caching.

### Added

- Initial Python implementation of browser-commander with full feature parity to JavaScript and Rust versions
- Support for both Playwright and Selenium browser engines with a unified API
- Page trigger system for navigation-aware automation logic
- Network request tracking and navigation management
- URL condition helpers (`make_url_condition`, `all_conditions`, `any_condition`, `not_condition`)
- Core browser automation functions: `click_button`, `fill_text_area`, `scroll_into_view`, `goto`
- Element visibility and content utilities
- Async/await support throughout the library
- Comprehensive unit tests (63 tests passing)

- `DialogManager` class (`core/dialog_manager.py`) for unified dialog event handling (alert, confirm, prompt, beforeunload)
- `BrowserCommander.on_dialog(handler)` — register a callback for browser dialogs; handler receives a Playwright Dialog object
- `BrowserCommander.off_dialog(handler)` — remove a previously registered dialog handler
- `BrowserCommander.clear_dialog_handlers()` — remove all dialog handlers
- `enable_dialog_manager` parameter (default `True`) in `make_browser_commander()` and `BrowserCommander.__init__()`
- Auto-dismiss behavior when no handlers are registered to prevent page freeze
- `DialogManager` exported from `browser_commander.exports`
- 19 new unit tests for dialog handling

- Document extensibility escape hatch: `commander.page` exposes the raw underlying Playwright/Selenium page object as an official mechanism for accessing engine-specific APIs not yet supported by browser-commander (e.g. `page.pdf()`, `page.emulate_media()`, `page.keyboard`, `page.on('dialog', ...)`).
- `launch_browser()` return value (`LaunchResult.page`) is documented as exposing the raw engine page.
- Added tests verifying `commander.page` is the exact raw page object passed to `make_browser_commander()`.

- Added `connect_browser()` and `ConnectOptions` for attaching Playwright or Selenium to an externally managed Chrome-family browser over CDP.

- Added `launch_real_browser()` for discovering and starting an installed Chrome-family browser with a dedicated profile before attaching over CDP.

- Applied automation-friendly Chromium launch defaults, including `--password-store=basic`, and added `extra_args` plus per-default opt-out controls.

- Added `browser_commander.fingerprint.automation_parity`, which keeps `navigator.webdriver` false by disabling the `AutomationControlled` Blink feature at launch, and reports which switches would have turned it on. `LaunchOptions.automation_parity` is on by default and also excludes the engine defaults a hand-started Chrome does not carry. The excluded defaults include Playwright's unconditional `--enable-unsafe-swiftshader`, which would otherwise give an automated browser a SwiftShader WebGL context on a machine where a hand-started Chrome has none.
- Added `browser_commander.fingerprint.profile`, `presets` and `derive`: `resolve_fingerprint_profile` validates and normalizes the 19 fields a page can read, `create_fingerprint_preset` builds internally consistent Windows, macOS, Linux and Android machines for a given Chrome version, and `derive_user_agent_data` reconstructs the User-Agent Client Hints Chrome would send for a user agent string. `FINGERPRINT_FIELD_MECHANISMS` records, per field, whether the browser itself produces the value or a page script patches it.
- Added `browser_commander.fingerprint.cdp_overrides` and `init_script`: `build_cdp_emulation_commands` turns a profile into the `Emulation` commands Chrome enforces for workers and HTTP headers too, and `build_fingerprint_init_script` covers the handful of fields the protocol has no command for. The page payload is not a translation -- `fingerprint/init_payload.js` ships as package data and is the same file JavaScript and Rust send, kept byte-identical by `scripts/check-shared-fingerprint-assets.sh`.
- Added `browser_commander.fingerprint.apply`: `apply_fingerprint` sends the overrides and installs the page script over CDP, for Playwright and for Selenium, whose blocking `execute_cdp_cmd` is wrapped so both engines take the same path. `LaunchOptions.fingerprint` applies a profile right after launch, before the first navigation.
- Added `browser_commander.fingerprint.limitations`: `FINGERPRINT_LIMITATIONS` documents what still cannot be made identical to a hand-started browser, and `relevant_fingerprint_limitations` narrows the catalogue to the entries a given profile and browser actually hit. The catalogue is data, so `fingerprint/limitations.json` ships as package data and is the same file JavaScript and Rust read, kept byte-identical by `scripts/check-shared-fingerprint-assets.sh`.

### Fixed

- Keep Python 3.9 type checking warning-free by using a compatible mypy release.

- Close the cookie SQLite connection after reading. `sqlite3.Connection.__exit__` only ends the transaction, so the previous `with` statement leaked one connection per read and produced `ResourceWarning: unclosed database` in every CI test run.

- Read `[project].version` from `pyproject.toml` by table rather than with `grep -Po '(?<=^version = ")[^"]*'`. The pattern is anchored to the line but blind to the table it sits in, so it also matched `[tool.scriv].version` and wrote two lines into `$GITHUB_OUTPUT`; every release since 2026-08-02 failed with `Invalid format 'literal: pyproject.toml: project.version'`. `scripts/version_and_commit.py` had the same blindness and rewrote the `[tool.scriv]` literal on each bump.

- Made a failed PyPI upload say what to do about it. Trusted publishing has no publisher registered for this repository, and `gh-action-pypi-publish` reports that as a wall of text ending in "could also indicate an internal error"; the release now prints which of PyPI's two registration forms applies and the exact owner, repository, workflow and environment values to enter.
- Started writing the changelog the release notes are read from. `scriv collect --version "$BUMP_TYPE"` names the new section rather than selecting a bump, so every release wrote a section titled `patch`, `CHANGELOG.md` went unwritten and each GitHub release body was the bare string `Release <version>`. Fragments are now collected under the version being released, and `[tool.scriv].md_header_level` matches the `## <version>` heading the release-notes extractor looks for.

- Started publishing the package. Every release so far died at the changelog push before reaching PyPI: the job checks out `github.sha`, so once another language's release had landed on `main` the push was rejected as non-fast-forward, and the assembled `CHANGELOG.md` was discarded with the runner. `scripts/git_push.py` now rebases and retries a push that lost the race, and reports a branch-protection rejection as itself rather than retrying something a rebase can never fix.
