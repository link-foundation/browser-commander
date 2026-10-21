---
'browser-commander': minor
---

Start Chrome for Testing by default instead of the user's Google Chrome (issue #179). Without `channel` or `executablePath`, `launchBrowser()`, `launchRealBrowser()` and the Selenium engine start the Chrome for Testing Playwright or Puppeteer installed (`channel: 'chrome'` still starts the installed Google Chrome), and fail with the install command when none is installed. Chrome for Testing gets the new `chrome-for-testing` default restrictions, `no-chrome-for-testing-infobar` (`--test-type=gpu`) and `mock-keychain` (`--use-mock-keychain`), so its "only for automated testing" bar and macOS keychain prompts are gone; `defaultRestrictions` replaces them, `[]` turns them off, and the session reports them as `defaultRestrictions`. Selenium's ChromeDriver is resolved for the Chrome for Testing that started, never a `chromedriver` on `PATH`, and password migration uses Chrome for Testing's key. `isChromeForTesting()` and `defaultRestrictionsFor()` are exported.

Also, trace checkpoint screenshots and default screenshots of a page without a fixed viewport are captured with CDP `Page.captureScreenshot` and no clip, so a resized headful window is no longer left drawn at its old size (issue #180).
