# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- changelog-insert-here -->
## [0.19.0] - 2026-10-06

### Changed

- The typed Puppeteer bindings now describe puppeteer-core 25.12.0, the version the JavaScript package installs (`PUPPETEER_VERSION` was still 25.10.0). The API is unchanged between the two versions.

### Fixed

- A Safari launch right after a previous Safari session closed starts a fresh `safaridriver`, up to three attempts, when the driver exits before it is ready or refuses the connection. safaridriver serves one automation session at a time, and CI saw both failures on back-to-back launches. Authorization errors are still reported at once. Set `VERBOSE=1` to log each retry.

### Added

- Safari and Technology Preview native W3C WebDriver control through real/common launchers, typed native handles, isolated cookie seeding, setup guidance and unsupported feature errors.

## [0.18.0] - 2026-10-05

### Added

- Native Safari bookmark/history and explicit Passwords CSV import into Chromium, named Safari profiles and modern WebKit cookie-store preference.
- Catalogue-derived executable discovery and profile protection, Opera Local State resolution, and Yandex Ya Passman encryption reports.
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

## [0.17.0] - 2026-10-05

### Added

- Accept `selenium` and `webdriver` aliases for native Fantoccini, including
  deserialization, and test the shared CLI across all three engine families.

### Changed

- Upgrade all direct dependencies and regenerate Puppeteer APIs and Playwright
  1.63 protocol bindings. Document native defaults and explicit bridge support.

## [0.16.0] - 2026-10-05

### Added

- Safari and Safari Technology Preview cookie import with installed/default/custom
  discovery, domain counts without decoding values, validated binarycookies decoding
  and Full Disk Access diagnostics. Native options and reports match JS and Python.
  Unsupported Safari classes and unavailable SameSite are reported explicitly.
  Remaining profile import requirements are tracked in issues #117–#120.

## [0.15.0] - 2026-10-05

### Added

- A shared, data-driven catalogue of importable browsers
  (`browser-sources.json`, byte-identical across the JavaScript, Python and
  Rust packages) covering Chrome and its Beta/Dev/Canary channels, Edge
  channels, Brave variants, Chromium, Opera and Opera GX, Vivaldi, Arc, Yandex,
  and Firefox with its LibreWolf, Waterfox, Zen, Floorp, Developer Edition and
  Nightly forks. It records each browser's per-platform profile roots, Chromium
  Safe Storage identity, and operating-system default identifiers.
- Resolution of the operating-system default web browser (macOS LaunchServices,
  Linux `xdg-settings`/`xdg-mime`, Windows `UserChoice` ProgId) to a catalogue
  id, so `default`/`auto` imports follow whichever browser a person actually
  uses.
- Profile discovery and migration classify a browser's engine family from the
  catalogue, so every catalogued Chromium variant and Firefox fork is
  recognised, and reading cookies honours a custom user-data directory.
- Listing of the browsers and profiles that hold cookies — optionally for
  specific domains — as names and counts only, never values.
- `migrate_profile` accepts `default`/`auto` as the source browser; scoped to
  `domains`, it falls back from a default browser that holds no cookies for
  them to the installed profile holding the most, and reports which one with a
  `default-browser-fallback` warning (`resolve_import_source`,
  `MigrateProfileOptions::environment`/`run_command`). Migrating from Opera or
  Opera GX now reads their single profile from the user data directory itself.

## [0.14.1] - 2026-10-01

### Fixed

- The crates.io publish script passes the token through `CARGO_REGISTRY_TOKEN` instead of the deprecated `cargo publish --token` flag, which also keeps it out of the process argument list.

## [0.14.0] - 2026-10-01

### Fixed

- Fresh real-browser launches seed Chromium's profile settings so the disposable window does not ask to become the system default browser. Callers can configure `default_browser_check`, `first_run`, `preferences`, and `local_state` without adding launch switches.

### Added
- Native typed extension relay with origin and extension-ID checks, tab
  operations, CDP sessions/events, bounded requests, cancellation cleanup and
  the bundled companion extension; session handles implement `CdpTransport`.
- Native typed parity measurement with a plain command-stream reference,
  the shared environment probe, command-line comparison and portable reports
  through Chromiumoxide, Playwright and Puppeteer.
- Native `snapshot_user_data_dir` and `launch_snapshot` for selected live
  Chromium profiles, including WAL backup, exclusion reports and owned-copy
  cleanup through Chromiumoxide, Playwright and Puppeteer.

### Fixed
- Live SQLite locks use the existing file-and-sidecar fallback immediately,
  avoiding a five-second wait for every locked database in a profile.

### Added

- Native trace recording (issue #108): `start_trace` records the same portable trace bundle JavaScript's `startTrace()` writes, record for record, with the same modes (mutations stream between checkpoints in `continuous` mode), the same redaction, size limits, dropped-record accounting and strict mode. `TraceRecorder` names checkpoints, records custom events, wraps interactions with `traced`, and stops once, optionally recording the error a run ended with or discarding the bundle.
- `write_trace_viewer` writes the same offline `viewer.html`, and `trace_links`/`write_trace_links` (or `TraceOptions::links` while recording) write the same Links Notation export. A conformance test holds the Rust output byte-for-byte to the JavaScript golden trace.
- The chromiumoxide adapter now supports init scripts and reports navigations, console output, page errors, failed requests and dialogs to a running trace. `EngineAdapter` gains `add_init_script`, `remove_init_script` and `trace_events`, with defaults that do nothing.
- `record_scenario` keeps a run's trace only when the run fails, the Rust counterpart of the JavaScript runner's `trace: 'retain-on-failure'` and Python's `traced()`: a failing run leaves its bundle, ending in a `failure` checkpoint with the offline viewer written next to it, and a passing run leaves nothing. `on` and `on-first-retry` are accepted too.

### Added

- Native ChromeDriver/geckodriver launch through command-stream, complete typed Fantoccini access, optional BiDi, portable state, copied Chromium profiles and common-launcher integration.
- Managed WebDriver downloads through browser preferences and the native staging watcher, including Firefox `.part` files.

### Fixed

- Abandoned managed process groups are terminated even after their Tokio runtime shuts down.
- Engine launches apply arbitrary Chromium preferences and Local State before starting the browser.

### Added

- Typed Rust bindings for every interface, command and event in Playwright's protocol spec (`browser_commander::playwright::protocol`), generated by `scripts/generate-playwright-protocol.mjs`, and a client that runs the official `playwright-core/cli.js run-driver` through command-stream.
- `PlaywrightDriverPage`, an `EngineAdapter` on that client, with `objects()` for typed access to the rest of Playwright.

### Changed

- The `playwright` engine in `launch_browser()` and `connect_browser()` uses the official driver when a `playwright-core` with the same protocol version is installed. It falls back to the Node bridge only when none is found.

### Added
- Playwright-compatible cookie and origin-scoped localStorage import/export
  through `StorageState`, `LaunchOptions::storage_state`,
  `ConnectOptions::storage_state`, and `save_storage_state` for Chromiumoxide,
  Playwright, and Puppeteer.

### Added

- Typed Puppeteer from Rust: `browser_commander::puppeteer` starts the JavaScript CLI's `serve --stdio` bridge and has a struct for every Puppeteer class and interface, with an `async fn` for every method and getter, own and inherited. `scripts/generate-puppeteer-bindings.mjs` generates them from puppeteer-core's `lib/types.d.ts`.

## [0.13.0] - 2026-09-29

### Added
- A `browser-commander` binary with the shared JSON command and `serve
  --stdio` protocols. Browser commands use the companion JavaScript CLI
  through `command-stream`; `version` reports the crate version locally.
- Read-only profile migration before `launch_real_browser`, including a
  migration report and cookie seeding, plus `open_in_user_browser()` for
  opening a URL without automation.
- `LaunchMode` (`Real`, the default, or `Engine`) and `LAUNCH_MODES`, selected with `LaunchOptions::launch` (issue #103). A real launch starts the installed Chrome itself and attaches the engine over CDP, so the browser behaves like one a person started and `navigator.webdriver` stays false. Without a `channel` or `executable_path` the installed Google Chrome is preferred and the engine's own browser is the fallback.
- `LaunchOptions::restrictions`, `LaunchOptions::env` and `LaunchOptions::remote_debugging_port`. Restrictions come from the shared catalogue (the old defaults are the `legacy-defaults` preset). Their environment and `env` go to the browser process only; the caller's environment is never modified.
- `LaunchResult::close()` closes a launched browser and deletes its temporary profile. It does nothing for a browser attached with `connect_browser`.
- New `LaunchResult` metadata: `launch`, `temporary_profile`, `args`, `cdp_endpoint`, `remote_debugging_port`, `executable_path` and `browser_process`.
- `launch_real_browser` uses a fresh temporary profile unless `user_data_dir` is given (issue #101). The profile's `Local State` keeps Chrome's What's New tab and Edge's welcome tab closed.
- `connect_browser` and the real launch pick the visible tab rather than the first one, and apply `color_scheme` to it.

### Changed
- `launch_browser` starts every launch, in both modes, with a fresh temporary profile unless `user_data_dir` is set, instead of `~/.browser-commander/<engine>-data`.
- `CHROME_ARGS` are no longer added to every launch. The constant is kept and equals the `legacy-defaults` restriction preset.
- `LaunchOptions::playwright()` no longer sets `slow_mo` to 150; it is 0 for every engine.
- `LaunchOptions::all_chrome_args()` returns `anyhow::Result<Vec<String>>` (an unknown restriction is an error), and `ignore_default_args` no longer filters it.
- A real launch uses a reserved fixed DevTools port: port 0 is refused because it turns `navigator.webdriver` on.
- `RealBrowserOptions::remote_debugging_port` is an `Option<u16>`, and `build_real_browser_args` requires `user_data_dir` and `remote_debugging_port` to be set on the options (`launch_real_browser` picks both itself when they are unset).
- `--headless` is no longer treated as an AutomationControlled trigger, so a headless real launch has exactly `--user-data-dir`, `--remote-debugging-port`, `--headless=new` and the start URL.
- A real launch opens `about:blank`, as Puppeteer and Playwright do, unless the caller's arguments contain a URL (`START_URL`). Without it Microsoft Edge opened its new-profile welcome flow, which closed the window and exited the browser a few seconds after launch.
- `BrowserProcess::kill` returns whether a signal was sent, and `try_wait` was removed in favour of `is_running`, `wait_timeout` and `exited`.
- The Playwright and Puppeteer bridge no longer sets `GOOGLE_API_KEY`, `GOOGLE_DEFAULT_CLIENT_ID` or `GOOGLE_DEFAULT_CLIENT_SECRET` in its own environment, and no longer passes `--start-maximized`.

### Deprecated
- `LaunchOptions::get_user_data_dir`: `launch_browser` no longer uses that directory. Read `LaunchResult::browser.user_data_dir` instead.

## [0.12.1] - 2026-09-21

### Fixed

- Rust API documentation now builds cleanly with warnings denied by using
  resolvable intra-doc links.

## [0.12.0] - 2026-09-16

### Added

- The `traces` module reads trace schema version 2: the mutation kinds a continuous recording writes, including the semantic live-state records for typing, checking, selecting, focus and scroll, the checkpoint reasons, and the replay-support flags a bundle declares. A bundle recorded by an older JavaScript run still reads, and one recorded by a newer schema is still refused rather than guessed at.

## [0.11.0] - 2026-09-16

### Added

- Added the `downloads` module. `DownloadOptions` is accepted by `launch_browser()`, `connect_browser()` and the real-browser launch helpers, and every entry point builds the same `DownloadManager`. `capture()` starts listening before the action runs so a fast download cannot be missed, the caller chooses the saved name and a bare UUID is given the extension its content proves, and the file is still there after the page, the context and the browser are gone. Chromiumoxide redirects downloads with `Browser.setDownloadBehavior` and a staging-directory watcher reports them, which also covers a download a person started by hand. The Node bridge and Fantoccini have no such mechanism, so asking them for downloads fails with that reason rather than quietly doing nothing. `rust/examples/managed_download.rs` drives a real Chromium through the whole lifecycle.
- Added the `traces` module, which reads the schema-versioned trace bundles a JavaScript run records - manifest, ordered NDJSON timeline, checkpoint DOM snapshots and mutation batches - and diffs checkpoint control state. Recording is not implemented in Rust yet, and `docs/feature-parity.md` says so.

### Changed

- `click_element()` now reports what was observed rather than what was attempted: `status` is one of `Succeeded`, `Failed`, `TimedOut`, `Interrupted` or `Unverified`, `effect` is `Confirmed`, `NotObserved` or `Contradicted`, and the evidence carries the reason for both. The `clicked` and `verified` booleans remain and are derived conservatively, so a click that changed nothing is no longer reported as verified. Readiness waits share one deadline and return per-check evidence.

### Deprecated

- `no_auto_scroll` is deprecated in favour of the `ClickScroll` axis (`Auto`, `Preserve`, `None`); `ActivationOptions::from_no_auto_scroll()` maps it onto `ClickScroll::None` and records the notice. `ClickScroll::None` fails with `ClickDispatchError::ScrollConstraint` on engines that cannot click without scrolling, instead of scrolling the page anyway.

## [0.10.12] - 2026-09-06

### Added

- `DialogManager` struct (`core/dialog.rs`) for managing browser dialog events across all engines
- `DialogEvent` — carries dialog type, message, and optional default value to handlers
- `DialogType` enum — `Alert`, `Confirm`, `Prompt`, `BeforeUnload`, `Unknown`
- `DialogManager::on_dialog(handler)` — register a synchronous handler for dialog events
- `DialogManager::clear_dialog_handlers()` — remove all registered handlers
- `DialogManager::dispatch(event)` — dispatch a dialog event to all registered handlers (called by engine integration)
- `DialogManager::handler_count()` — inspect number of registered handlers
- `DialogEvent`, `DialogManager`, `DialogType` re-exported from crate root and `prelude`
- 15 new unit tests plus 2 doc-tests for dialog handling

### Added

- Real Chromium launch via `chromiumoxide` in `launch_browser`. Previously the Rust `launch_browser` created a user data directory and returned metadata only; it now starts a Chromium process, completes the CDP handshake, opens an initial page, and returns a live page adapter.
- `LaunchResult.page: Arc<dyn EngineAdapter>` — live page handle returned from `launch_browser`, usable with all of the crate's navigation, interaction, and query helpers (`goto`, `click`, `fill`, `evaluate`, `is_visible`, `count`, ...).
- `ChromiumoxidePage` adapter (`browser::chromiumoxide_adapter`) implementing the full `EngineAdapter` trait on top of `chromiumoxide::Page`, including navigation, element interaction, evaluation, screenshots, PDF printing (with CSS length/paper-format parsing), keyboard events, and color-scheme emulation.
- `LaunchOptions::sandbox(bool)` and `LaunchOptions::launch_timeout(Duration)` builder methods for CI-friendly launches.
- `ChromiumoxidePage::raw_page()` escape hatch for chromiumoxide-specific APIs not yet covered by the unified trait.
- Integration smoke test (`tests/launch_smoke.rs`, `--ignored`) that launches a real headless Chromium, navigates, evaluates JavaScript, and checks visibility / element counts.

### Fixed

- README quick-start example now compiles against the real `launch_browser` API (`result.page.as_ref().goto(...)`) instead of the previous placeholder signature.

### Added
- Added first-class Rust Playwright and Puppeteer engine variants backed by a Node.js bridge to the official packages.

### Added

- Added `LaunchOptions::channel` and `LaunchOptions::executable_path` for reusing an installed Chrome-family browser.

### Added

- Added `connect_browser()` and `ConnectOptions` for attaching Chromiumoxide, Playwright, or Puppeteer to an externally managed Chrome-family browser over CDP.

### Added

- Added `launch_real_browser()` for discovering and starting an installed Chrome-family browser with a dedicated profile before attaching over CDP.

### Added

- Added installed Chrome, Edge, Brave, Chromium, and Firefox profile discovery and cookie import, including platform decryption and an owner-only cross-process cache.

### Added

- Applied automation-friendly Chromium launch defaults, including `--password-store=basic`, and added extra-argument plus per-default opt-out builders.

### Changed

- Depend on `fantoccini` with `default-features = false` and `rustls-tls`, so `openssl-sys` is no longer pulled into consumers' dependency trees and the crate builds on images without `pkg-config` or OpenSSL headers.

### Added

- Optional `native-tls` feature that re-enables `fantoccini/native-tls` for consumers that want the system TLS stack.

### Added

- Added the `fingerprint` module, which keeps `navigator.webdriver` false by disabling the `AutomationControlled` Blink feature at launch and reports which switches would have turned it on. `LaunchOptions::automation_parity` is on by default and also excludes the engine defaults a hand-started Chrome does not carry. The excluded defaults include Playwright's unconditional `--enable-unsafe-swiftshader`, which would otherwise give an automated browser a SwiftShader WebGL context on a machine where a hand-started Chrome has none.
- Added `fingerprint::profile`, `fingerprint::presets` and `fingerprint::derive`: `resolve_fingerprint_profile` validates and normalizes the 19 fields a page can read, `create_fingerprint_preset` builds internally consistent Windows, macOS, Linux and Android machines for a given Chrome version, and `derive_user_agent_data` reconstructs the User-Agent Client Hints Chrome would send for a user agent string. `FINGERPRINT_FIELD_MECHANISMS` records, per field, whether the browser itself produces the value or a page script patches it.
- Added `fingerprint::cdp_overrides` and `fingerprint::init_script`: `build_cdp_emulation_commands` turns a profile into the `Emulation` commands Chrome enforces for workers and HTTP headers too, and `build_fingerprint_init_script` covers the handful of fields the protocol has no command for. The page payload is not a translation -- `init_payload.js` is embedded with `include_str!` from the same file JavaScript and Python send, kept byte-identical by `scripts/check-shared-fingerprint-assets.sh`.
- Added `fingerprint::apply`: `apply_fingerprint` sends the overrides and installs the page script through a `CdpTransport`, which `ChromiumoxidePage` implements. `LaunchOptions::fingerprint` applies a profile right after launch, before the first navigation, and `browser::RawCdpCommand` makes it possible to send a CDP command chromiumoxide has no generated type for.
- Added `fingerprint::limitations`: `FINGERPRINT_LIMITATIONS` documents what still cannot be made identical to a hand-started browser, and `relevant_fingerprint_limitations` narrows the catalogue to the entries a given profile and browser actually hit. The catalogue is embedded with `include_str!` from the same `limitations.json` JavaScript and Python read, with `severity` and `evidence` as enums so an unknown value fails at parse time.

### Changed

- Updated every dependency to its current release: `chromiumoxide` 0.7 to 0.9, `fantoccini` 0.21 to 0.22, `thiserror` 1 to 2, `rusqlite` 0.32 to 0.40, `dirs` 5 to 6, `base64` 0.22 to 0.23 and the RustCrypto set (`aes` 0.9, `aes-gcm` 0.11, `cbc` 0.2, `pbkdf2` 0.13, `sha1`/`sha2` 0.11). `chromiumoxide` 0.9 is tokio-only and no longer takes a runtime feature, and its remaining TLS features reach only the optional browser fetcher, so the default tree still contains no `openssl-sys`.

### Fixed

- Restored the crates.io release. The publish scripts loaded `command-stream` through use-m, which returns an unusable namespace on the Node 24 the release job pins, so the job stopped at `TypeError: $ is not a function`; they now load it through the shared `scripts/use-module.mjs` shim. `Cargo.toml` fields are read by table instead of `grep ... | head -1`, which only happened to be right while `[package]` preceded the `[[bin]]` and `[lib]` tables that repeat `name`.

### Fixed

- Stopped publishing versions to crates.io that were never committed. `version-and-commit.mjs` bumped `Cargo.toml`, and the `catch` that was supposed to abort when the commit failed could never run, because `command-stream`'s `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

 resolves rather than rejects on a non-zero exit; twelve releases shipped from an unchanged tree. The commit is now gated on the list of files the commit would actually contain, every publish step requires `version_committed`, `Cargo.lock` is refreshed with the bump so `cargo build --locked` still accepts the release commit, and the changelog fragments are collected after the bump has computed the version instead of before, which used to file the notes under the version that was already released.
- Gave the crate its own `rust-v<version>` tag namespace. It shared `v<version>` with the JS package, so whichever language reached a number second released without a tag, and `v0.10.11` — a crates.io version — points at the JS 0.17.0 release commit.

### Fixed

- Landed the release commit that the crate is published from. The push to `main` was rejected as non-fast-forward whenever another language's release job had already written to `main`, which is why crates.io reached 0.10.11 while `Cargo.toml` still said 0.9.0 and no `rust-v*` tag was ever created. The push now rebases and retries, and the tag is created after the push succeeds so a rebase cannot leave it on an orphaned commit.
- Stopped reporting one fact twelve times. Walking past the versions already on crates.io emitted a `::warning::` per step — 12 in the last release — which crowds out the ten annotations GitHub will show. The drift is now reported once, naming the range and the cause; the per-version detail moved behind `CI_SCRIPTS_DEBUG`.


## [0.1.0] - 2024-12-30

### Added

- Initial Rust implementation of browser-commander library
- Core modules: constants, logger, engine adapter trait, navigation safety
- Elements modules: selectors, visibility checking, content extraction
- Interactions modules: click, scroll, fill operations with verification
- Browser modules: launcher, navigation operations
- Utilities modules: URL handling, wait/sleep operations
- High-level universal DRY utilities
- 103 unit tests and 3 doc tests
- Async/await support with Tokio runtime
- Chrome DevTools Protocol support via chromiumoxide
- WebDriver support via fantoccini
