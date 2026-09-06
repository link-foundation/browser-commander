
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
