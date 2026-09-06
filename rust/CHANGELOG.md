# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- changelog-insert-here -->
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
