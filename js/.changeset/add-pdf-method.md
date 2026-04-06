---
'browser-commander': minor
---

Add unified `page.pdf(options)` method to `EngineAdapter`, `PlaywrightAdapter`, and `PuppeteerAdapter`, eliminating the need for users to access raw page objects via the `page._page || page` workaround. The `pdf()` method is also exposed on the `BrowserCommander` facade via `commander.pdf({ pdfOptions })`.
