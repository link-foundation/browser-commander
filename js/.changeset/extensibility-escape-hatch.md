---
"browser-commander": minor
---

Document extensibility escape hatch: `commander.page` and `launchBrowser()` return values expose the raw underlying Playwright/Puppeteer page object as an official mechanism for accessing engine-specific APIs not yet supported by browser-commander (e.g. `page.pdf()`, `page.emulateMedia()`, `page.keyboard`, `page.on('dialog', ...)`). Adds tests verifying `commander.page` is the exact raw page object.
