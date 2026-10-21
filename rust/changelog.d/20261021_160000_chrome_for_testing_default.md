---
bump: minor
---

### Changed

- Without `channel` or `executable_path`, `launch_browser()` and `launch_real_browser()` start Chrome for Testing instead of the user's Google Chrome: the one Playwright or Puppeteer reports, else the newest in the Playwright, Puppeteer or Selenium Manager download caches. `channel("chrome")` still starts the installed Google Chrome, and a launch without any Chrome for Testing fails with the install command (issue #179).

### Added

- Chrome for Testing gets the `chrome-for-testing` default restrictions, `no-chrome-for-testing-infobar` (`--test-type=gpu`) and `mock-keychain` (`--use-mock-keychain`), which hide its "only for automated testing" bar and keep it from the macOS keychain. `LaunchOptions::default_restrictions` and `RealBrowserOptions::default_restrictions` replace them (an empty list turns them off), the results report them as `default_restrictions`, and `CHROME_FOR_TESTING_PRESET`, `chrome_for_testing_restrictions()`, `is_chrome_for_testing()` and `default_restrictions_for()` are exported (issue #179).

### Fixed

- Fantoccini uses a chromedriver matching the Chrome for Testing it starts, and password migration re-encrypts with Chrome for Testing's keychain key (issue #179).
- Trace checkpoint screenshots and default screenshots of a page without a fixed viewport are captured with CDP `Page.captureScreenshot` and no clip, so a resized headful window is no longer left drawn at its old size (issue #180).
