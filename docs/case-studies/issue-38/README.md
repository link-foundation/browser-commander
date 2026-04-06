# Case Study: Issue #38 - Missing Dialog/Alert Event Handling Support

## Summary

Browser-commander does not expose a unified `page.on('dialog', handler)` API for handling browser dialogs
(alerts, confirms, prompts) that appear during page load or interaction. Users are forced to access raw
engine-specific page objects with an unsafe workaround. This case study documents the root cause, timeline,
existing evidence, and the proposed solution across all three language implementations (JavaScript, Python, Rust).

---

## Issue Details

- **Issue**: https://github.com/link-foundation/browser-commander/issues/38
- **Title**: Missing dialog/alert event handling support (page.on('dialog', ...))
- **Reported by**: konard (Konstantin Diachenko)
- **Status**: Open
- **Related PR**: https://github.com/link-foundation/browser-commander/pull/43

---

## User-Reported Workaround

From `web-capture/js/src/popups.js`:

```js
// Current workaround in popups.js
const rawPage = page._page || page;
if (typeof rawPage.on === 'function') {
  rawPage.on('dialog', async (dialog) => {
    try {
      await dialog.dismiss();
    } catch {
      /* ignore */
    }
  });
}
```

This workaround:
1. Accesses private/internal `_page` property which may break across versions
2. Bypasses browser-commander's event management and lifecycle tracking
3. Does not integrate with the session/navigation cleanup system
4. Is engine-specific (not portable between Playwright and Puppeteer)

Related external issue: https://github.com/link-assistant/web-capture/pull/9

---

## Timeline / Sequence of Events

1. **Problem emerges**: Many web pages show alerts/confirms during page load or on interaction.
   Browser automation tools like `web-capture` must dismiss them automatically or the page freezes.

2. **Workaround adopted**: `web-capture` accessed `page._page` (the raw Playwright page) to call
   `page.on('dialog', ...)` directly, bypassing browser-commander entirely.

3. **Feature request filed** (issue #38): The workaround is fragile and not portable. A proper,
   unified API in browser-commander is needed.

4. **Analysis**: The existing NavigationManager already registers `page.on('framenavigated')` and
   NetworkTracker registers request events - the same pattern needs to be applied for dialog events.

---

## Root Cause Analysis

### Primary Root Cause

**Browser-commander does not implement a dialog event manager**, despite the underlying Playwright and
Puppeteer engines both supporting `page.on('dialog', handler)`.

The `NavigationManager` in `js/src/core/navigation-manager.js` demonstrates the correct pattern:

```js
// NavigationManager registers:
page.on('framenavigated', handleFrameNavigation);

// The same pattern is needed for dialogs:
page.on('dialog', handleDialog);
```

### Missing API Surface

Neither `factory.js` nor `bindings.js` expose any dialog-related methods. The `commander` object
returned by `makeBrowserCommander()` has no `onDialog()` or `page.on('dialog')` equivalents.

### Why Both Engines Support This

**Playwright** (`page.on('dialog', handler)`):
- Handler receives a `Dialog` object with: `accept(text?)`, `dismiss()`, `message()`, `type()`
- Dialog types: `'alert'`, `'confirm'`, `'prompt'`, `'beforeunload'`
- Reference: https://playwright.dev/docs/dialogs

**Puppeteer** (`page.on('dialog', handler)`):
- Handler receives a `Dialog` object with: `accept(text?)`, `dismiss()`, `message()`, `type()`
- Same interface as Playwright
- Reference: https://pptr.dev/api/puppeteer.page.on

Both engines share an identical API surface for dialog handling, making a unified wrapper straightforward.

---

## Proposed Solution

### JavaScript Implementation

Create `js/src/core/dialog-manager.js` that:
1. Registers `page.on('dialog', ...)` on both Playwright and Puppeteer pages
2. Exposes `onDialog(handler)` / `offDialog(handler)` to user code
3. Integrates with the navigation session lifecycle (auto-cleanup on navigation)
4. Exposes a unified `DialogEvent` object with `accept()`, `dismiss()`, `message()`, `type()`

Add to `factory.js`: `commander.onDialog(fn)` method
Add to `exports.js`: Export `createDialogManager`
Add to `bindings.js` or `factory.js`: Wire up the dialog manager

### Python Implementation

Create `python/src/browser_commander/core/dialog_manager.py` with the same pattern as
`NavigationManager` in Python.

Add `on_dialog(handler)` / `off_dialog(handler)` methods to `BrowserCommander` class.

### Rust Implementation

Create `rust/src/core/dialog_manager.rs` using `chromiumoxide`'s event system.

Add dialog handling to the Rust `BrowserCommander` struct.

---

## Known Existing Components / Libraries

- **Playwright Dialog API**: https://playwright.dev/docs/dialogs - Native support in Playwright
- **Puppeteer Dialog API**: https://pptr.dev/api/puppeteer.dialog - Native support in Puppeteer
- **chromiumoxide (Rust)**: Uses Chrome DevTools Protocol events for dialog handling via
  `page.event::<EventJavascriptDialogOpening>()` and `page.handle_dialog()`

---

## References

- Issue #38: https://github.com/link-foundation/browser-commander/issues/38
- web-capture PR #9: https://github.com/link-assistant/web-capture/pull/9
- Playwright Dialog docs: https://playwright.dev/docs/dialogs
- Puppeteer Dialog API: https://pptr.dev/api/puppeteer.dialog
- NavigationManager pattern: `js/src/core/navigation-manager.js`
