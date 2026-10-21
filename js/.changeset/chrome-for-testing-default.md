---
'browser-commander': minor
---

Launches without `channel` or `executablePath` start Chrome for Testing (the one Playwright or Puppeteer downloaded; Selenium also tries the one Selenium Manager keeps) instead of the installed Google Chrome, which is used only on request and never as a silent fallback (#179). A Chrome for Testing launch gets the new `chrome-for-testing` restriction preset by default: `no-chrome-for-testing-infobar` (`--test-type=gpu`) and `mock-keychain` (`--use-mock-keychain`); `defaultRestrictions` changes it. New exports: `isChromeForTesting`, `defaultRestrictionsFor`, `CHROME_FOR_TESTING_RESTRICTIONS`.

Trace checkpoint screenshots and default screenshots of pages without a fixed viewport use CDP `Page.captureScreenshot` without a clip, so a headful window resized during a capture keeps its real size (#180).
