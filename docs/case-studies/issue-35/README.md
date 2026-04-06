# Case Study: Issue #35 – Missing `page.pdf()` Support for PDF Generation

## Timeline / Sequence of Events

1. **Issue filed** (2026-04-06): [konard](https://github.com/konard) reports that `browser-commander` lacks a unified `page.pdf()` method.
2. **Root cause identified**: The `EngineAdapter` base class, both concrete adapters (`PlaywrightAdapter`, `PuppeteerAdapter`), the binding layer, and the factory all have no `pdf(options)` method, so users must access the raw page object via `page._page || page` workaround.
3. **Related project**: The workaround was discovered in [`web-capture` PR #9](https://github.com/link-assistant/web-capture/pull/9) which calls `rawPage.pdf(...)` bypassing the abstraction.
4. **Fix implemented**: Added `pdf(options)` to all three language implementations (JavaScript, Python, Rust).

---

## Root Cause Analysis

### JavaScript

`engine-adapter.js` defines `EngineAdapter`, `PlaywrightAdapter`, and `PuppeteerAdapter`. Neither the base class nor the concrete adapters expose a `pdf()` method.

- **Playwright** supports: `page.pdf({ format, printBackground, margin, ... })` – [docs](https://playwright.dev/docs/api/class-page#page-pdf).
- **Puppeteer** supports: `page.pdf({ format, printBackground, margin, ... })` – [docs](https://pptr.dev/api/puppeteer.page.pdf).

Both engines have identical signatures and behaviour for `pdf()`, making this a straightforward addition.

The `bindings.js` module binds all page-level operations and exposes them through the commander object, but `pdf` was never added.

### Python

`engine_adapter.py` defines `EngineAdapter`, `PlaywrightAdapter`, `SeleniumAdapter`. The Python `PlaywrightAdapter` delegates to `page.pdf()` which is supported by Playwright for Python. Selenium/WebDriver has no native PDF generation – the adapter raises `NotImplementedError`.

### Rust

`engine.rs` defines the `EngineAdapter` trait. The `screenshot()` method was already present (returns `Vec<u8>`). The same `Vec<u8>` pattern applies to PDF.

---

## Known Existing Solutions / Libraries

| Engine | PDF method | Notes |
|--------|-----------|-------|
| Playwright (JS/Python) | `page.pdf(options)` | Full CSS print-media rendering, Chromium only |
| Puppeteer (JS) | `page.pdf(options)` | Same interface, same engine |
| Selenium | No native support | Must use DevTools Protocol or third-party addon |

---

## Proposed Solution

Add a `pdf(options)` method to:

1. **JS** – `EngineAdapter` base class (throws), `PlaywrightAdapter` (delegates to `page.pdf(options)`), `PuppeteerAdapter` (delegates to `page.pdf(options)`), `bindings.js`, `factory.js`, `exports.js`.
2. **Python** – `EngineAdapter` ABC (`@abstractmethod`), `PlaywrightAdapter` (delegates to `page.pdf(**options)`), `SeleniumAdapter` (raises `NotImplementedError`).
3. **Rust** – `EngineAdapter` trait (`async fn pdf`), existing concrete implementations.

### Unified API (JavaScript)

```js
const pdfBuffer = await commander.pdf({
  format: 'A4',
  printBackground: true,
  margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' },
});
```

### Unified API (Python)

```python
pdf_bytes = await commander.pdf(
    format='A4',
    print_background=True,
    margin={'top': '1cm', 'right': '1cm', 'bottom': '1cm', 'left': '1cm'},
)
```

---

## Important Caveats

- PDF generation only works in Chromium-based engines (Playwright Chromium, Puppeteer). Firefox and WebKit do not support `page.pdf()` in Playwright.
- Puppeteer requires the browser to be launched without `headless: false`; i.e. in headless mode PDF works.
- Selenium has no native equivalent.
