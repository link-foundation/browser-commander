# Case Study: Issue #36 - Missing Color Scheme Emulation

## Overview

**Issue:** [#36 - Missing color scheme emulation (emulateMedia / CDP prefers-color-scheme)](https://github.com/link-foundation/browser-commander/issues/36)

**Type:** Feature Request

**Scope:** JavaScript, Python, Rust implementations

---

## Timeline / Sequence of Events

1. `browser-commander` provides a unified browser automation API over Playwright and Puppeteer (JS), Playwright and Selenium (Python), and Chromiumoxide/Fantoccini (Rust).
2. Consumer project `web-capture` (https://github.com/link-assistant/web-capture) needs to capture web screenshots in both light and dark themes.
3. `web-capture` implements engine-specific workarounds in `js/src/browser.js`:
   - **Playwright**: `await newPage.emulateMedia({ colorScheme })`
   - **Puppeteer**: `const client = await newPage.createCDPSession(); await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: colorScheme }] })`
4. These workarounds break the unified abstraction layer of `browser-commander`.
5. Issue filed requesting a unified `emulateMedia` API, with two proposed forms:
   - **Page method**: `await page.emulateMedia({ colorScheme: 'dark' })`
   - **Launch option**: `await launchBrowser({ engine, colorScheme: 'dark' })`

---

## Root Cause Analysis

`browser-commander` does not expose `emulateMedia` or any media/color-scheme emulation API because:

1. **Playwright** has `page.emulateMedia({ colorScheme })` and also supports it at context launch time via `colorScheme` option in `chromium.launchPersistentContext(...)`.
2. **Puppeteer** lacks a direct `emulateMedia` method but supports it via the CDP session: `page.createCDPSession()` → `client.send('Emulation.setEmulatedMedia', ...)`.
3. There is no "emulateMedia" abstraction in the `EngineAdapter` class or the public API surface.
4. `launchBrowser` has no `colorScheme` parameter.

---

## Known Existing Solutions

### Playwright
- [page.emulateMedia(options)](https://playwright.dev/docs/api/class-page#page-emulate-media) — supports `colorScheme: 'light' | 'dark' | 'no-preference' | null`
- `colorScheme` option in `BrowserContext` constructor (via `launchPersistentContext`)

### Puppeteer
- [page.emulateMediaFeatures(features)](https://pptr.dev/api/puppeteer.page.emulatemediafeatures) — available since Puppeteer v5.4.0
- CDP: `Emulation.setEmulatedMedia` with `features: [{ name: 'prefers-color-scheme', value }]`
- Note: In modern Puppeteer, `page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }])` is the preferred API.

### Selenium / Python
- No native `emulateMedia` API; must use Chrome DevTools Protocol (CDP) via `driver.execute_cdp_cmd('Emulation.setEmulatedMedia', ...)`.

---

## Proposed Solution

### JavaScript

1. Add `emulateMedia({ colorScheme })` function in a new `js/src/browser/media.js` module.
2. Use `page.emulateMedia({ colorScheme })` for Playwright.
3. Use `page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: colorScheme }])` for Puppeteer.
4. Add `emulateMedia` to `EngineAdapter` base class with implementations in `PlaywrightAdapter` and `PuppeteerAdapter`.
5. Expose `emulateMedia` in `createBoundFunctions` and `makeBrowserCommander`.
6. Add `colorScheme` option to `launchBrowser` to apply emulation immediately after launch.

### Python

1. Add `emulate_media(options)` to the Python `EngineAdapter` and its subclasses.
2. For Playwright: use `page.emulate_media(color_scheme=...)`.
3. For Selenium: use `driver.execute_cdp_cmd('Emulation.setEmulatedMedia', ...)`.
4. Add `color_scheme` to `LaunchOptions` and apply after browser launch.

### Rust

1. Add `emulate_media` to the Rust `EngineAdapter` trait.
2. Implement via chromiumoxide's `Page::emulate_media` or CDP command.
3. Add `color_scheme` to `LaunchOptions`.

---

## Valid Color Scheme Values

- `"light"` - Light color scheme
- `"dark"` - Dark color scheme  
- `"no-preference"` - No preference (system default)

---

## References

- [Playwright emulateMedia docs](https://playwright.dev/docs/api/class-page#page-emulate-media)
- [Puppeteer emulateMediaFeatures docs](https://pptr.dev/api/puppeteer.page.emulatemediafeatures)
- [Chrome DevTools Protocol - Emulation.setEmulatedMedia](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/#method-setEmulatedMedia)
- [web-capture PR #9](https://github.com/link-assistant/web-capture/pull/9) — Related consumer using the workaround
