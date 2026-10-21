---
bump: patch
---

### Fixed
- A chromiumoxide engine launch (`LaunchMode::Engine`) without a `channel` or `executable_path` now starts the newest cached Chrome for Testing - chromiumoxide itself would detect the installed Google Chrome - and fails with the install hint when there is none (issue #179).
- fantoccini drives Chrome for Testing with a chromedriver of its version instead of the `chromedriver` on `PATH`, which belongs to the installed Google Chrome and refuses another release ("This version of ChromeDriver only supports Chrome version …"). Without a `driver_executable`, the chromedriver Selenium Manager or `@puppeteer/browsers` downloaded for the same release is used, else the newest cached one of the same major version; an engine launch prefers a Chrome for Testing download whose chromedriver is cached.
