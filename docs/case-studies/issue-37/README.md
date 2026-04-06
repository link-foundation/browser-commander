# Case Study: Issue #37 - Missing Keyboard Interaction Support

## Overview

**Issue:** [#37 - Missing keyboard interaction support (page.keyboard.press)](https://github.com/link-foundation/browser-commander/issues/37)
**Reporter:** konard (Konstantin Diachenko)
**Status:** Resolved in PR #42

---

## Timeline / Sequence of Events

1. **Discovery**: `web-capture` project needed to dismiss popups and cookie banners by pressing `Escape` key.
2. **Workaround discovered**: `popups.js` in web-capture started using raw page object access:
   ```js
   const rawPage = page._page || page;
   if (rawPage.keyboard) {
     await rawPage.keyboard.press('Escape');
   }
   ```
3. **Root cause identified**: `browser-commander`'s `EngineAdapter` only exposed element-level typing (`type()`), but **no page-level keyboard methods**.
4. **Feature request filed**: Issue #37 opened requesting unified `keyboard` API.

---

## Root Cause Analysis

### What was missing

The `EngineAdapter` base class (`js/src/core/engine-adapter.js`) had:
- `type(locatorOrElement, text)` — element-level simulated typing
- `fill(locatorOrElement, text)` — element-level direct value assignment

But **no page-level keyboard interface** was exposed:
- No `keyboard.press(key)` — to press a single key (e.g. `Escape`, `Enter`, `Tab`)
- No `keyboard.type(text)` — to type a string at the page level
- No `keyboard.down(key)` / `keyboard.up(key)` — for key hold/release

### Why this matters

Keyboard interaction at the **page level** (not element level) is fundamental for:
- Dismissing dialogs/modals (Escape key)
- Submitting forms (Enter key)
- Tab navigation between form fields
- Keyboard shortcuts (Ctrl+A, Ctrl+C, etc.)
- Accessibility testing

### Engine support

Both engines natively support page-level keyboard:

| API | Playwright | Puppeteer |
|-----|-----------|---------|
| `keyboard.press(key)` | `page.keyboard.press(key)` | `page.keyboard.press(key)` |
| `keyboard.type(text)` | `page.keyboard.type(text)` | `page.keyboard.type(text)` |
| `keyboard.down(key)` | `page.keyboard.down(key)` | `page.keyboard.down(key)` |
| `keyboard.up(key)` | `page.keyboard.up(key)` | `page.keyboard.up(key)` |

---

## Solution

### Proposed API

```js
// Through browser commander instance
await commander.keyboard.press('Escape');
await commander.keyboard.type('Hello World');
await commander.keyboard.down('Control');
await commander.keyboard.up('Control');
```

### Implementation

1. Added `keyboardPress()`, `keyboardType()`, `keyboardDown()`, `keyboardUp()` abstract methods to `EngineAdapter` base class.
2. Implemented methods in `PlaywrightAdapter` and `PuppeteerAdapter`.
3. Created `js/src/interactions/keyboard.js` module with high-level `pressKey()`, `typeText()`, `keyDown()`, `keyUp()` functions.
4. Exposed `keyboard` object on browser commander via `bindings.js` and `factory.js`.
5. Replicated keyboard support in Python (`PlaywrightAdapter` + `SeleniumAdapter`) and Rust (`EngineAdapter` trait).
6. Updated `exports.js`, `mocks.js`, docs, and added comprehensive unit/e2e tests.

---

## Related Resources

- [web-capture PR #9](https://github.com/link-assistant/web-capture/pull/9) — the original workaround
- `js/src/popups.js` — uses the keyboard workaround
- [Playwright keyboard docs](https://playwright.dev/docs/api/class-keyboard)
- [Puppeteer keyboard docs](https://pptr.dev/api/puppeteer.keyboard)
