---
bump: minor
---

### Changed
- `launch_browser()` and `launch_real_browser()` without a `channel` or `executable_path` now start Chrome for Testing instead of the installed Google Chrome (issue #179). It finds the engine's bundled browser or the newest one in the Playwright (`PLAYWRIGHT_BROWSERS_PATH`), Puppeteer (`PUPPETEER_CACHE_DIR`) and Selenium Manager caches, and otherwise fails with an error that names the install command and `channel("chrome")`.
- A Chrome for Testing launch gets the `chrome-for-testing` restriction preset (`--test-type=gpu`, `--use-mock-keychain`) before the caller's restrictions, so it shows no "only for automated testing" infobar. The new `default_restrictions` option on `LaunchOptions`, `RealBrowserOptions` and `WebDriverOptions` replaces that choice (an empty list opts out), and launch results report the applied `default_restrictions`.
- `RealBrowserOptions::channel` is now an `Option<String>` (`None` = Chrome for Testing); `browser_channel()` returns the browser family, `"chrome"` when no channel is named.
- Added `is_chrome_for_testing()`, `default_restrictions_for()` and `chrome_for_testing_restrictions()`.
