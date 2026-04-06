---
'browser-commander': minor
---

Add unified dialog event handling API (`page.on('dialog', handler)`)

- New `DialogManager` (`core/dialog-manager.js`) that registers `page.on('dialog')` for both Playwright and Puppeteer
- `commander.onDialog(handler)` — register a handler for browser dialogs (alert, confirm, prompt, beforeunload)
- `commander.offDialog(handler)` — remove a previously registered handler
- `commander.clearDialogHandlers()` — remove all dialog handlers
- Auto-dismiss behavior when no handlers are registered (prevents page from freezing)
- `enableDialogManager` option (default: `true`) to opt out if needed
- Exports `createDialogManager` for low-level usage
- 19 new unit tests covering all dialog handling scenarios
