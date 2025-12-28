---
'browser-commander': minor
---

Add Playwright text selector support and use TIMING constants

- Add `isPlaywrightTextSelector()` and `parsePlaywrightTextSelector()` functions
- Update `normalizeSelector()` to convert Playwright text selectors (`:has-text()`, `:text-is()`) to valid CSS selectors
- Update `withTextSelectorSupport()` to handle both Puppeteer and Playwright text selectors
- Add `NAVIGATION_TIMEOUT` constant and use it in navigation-manager
