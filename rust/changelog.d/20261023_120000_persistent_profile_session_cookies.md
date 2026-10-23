---
bump: minor
---

### Added
- A launch with an explicit `user_data_dir` keeps session cookies (cookies without an expiry date, which most logins set) across a normal `close()` and relaunch (issue #187). Before, Chromium deleted them on every clean start, so a persistent profile lost its logins. The browser's own encrypted cookie store keeps them: Chromium launches with `--restore-last-session`, and the last session's tabs are deleted first so the launch still starts with one tab (`restore_tabs(true)` reopens them). Firefox under fantoccini restores its previous session (`browser.startup.page = 3`) and closes the restored windows. The Playwright engine launches the full Chromium build headless (channel `chromium`), because the headless shell cannot keep session cookies; Safari and an explicitly selected headless shell return a `keep_session_cookies` warning in `warnings`.
- Every entry point supports it: `launch_browser` with every engine and `LaunchMode`, `connect_or_launch`, `launch_real_browser` and the CLI (`--keep-session-cookies`, `--no-keep-session-cookies`, `--restore-tabs`). `keep_session_cookies(false)` opts out, and temporary profiles behave as before. `LaunchResult`, `RealBrowserLaunchResult`, `ManagedWebDriver` and `PersistentSession` report `keep_session_cookies` and `warnings`. New exports: `persistent_profile_args()`, `clear_restored_tabs()`, `prepare_session_restore()`, `SessionCookieWarning` and `KEEP_SESSION_COOKIES_SWITCH`. The opt-in plaintext `persist_session_cookies` file is unchanged.

### Fixed
- A chromiumoxide engine launch (`LaunchMode::Engine`) now passes every extra switch to Chrome. chromiumoxide's builder writes `--{key}` itself, so switches that were handed to it whole reached Chrome as `----restore-last-session` or `----disable-blink-features=AutomationControlled`, and Chrome ignored them. Each switch is now split into its key and value first.
