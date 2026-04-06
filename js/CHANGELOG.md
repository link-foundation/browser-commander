# Changelog

## 0.8.0

### Minor Changes

- a681a87: Add unified `page.pdf(options)` method to `EngineAdapter`, `PlaywrightAdapter`, and `PuppeteerAdapter`, eliminating the need for users to access raw page objects via the `page._page || page` workaround. The `pdf()` method is also exposed on the `BrowserCommander` facade via `commander.pdf({ pdfOptions })`.

## 0.7.0

### Minor Changes

- Add emulateMedia API for unified color scheme emulation across all engines

  Implements `emulateMedia({ colorScheme })` as a unified API for color scheme emulation (prefers-color-scheme) across Playwright and Puppeteer engines. Also adds `colorScheme` as a launch option to `launchBrowser`.

  Fixes #36

- 785eb13: Add unified dialog event handling API (`page.on('dialog', handler)`)
  - New `DialogManager` (`core/dialog-manager.js`) that registers `page.on('dialog')` for both Playwright and Puppeteer
  - `commander.onDialog(handler)` — register a handler for browser dialogs (alert, confirm, prompt, beforeunload)
  - `commander.offDialog(handler)` — remove a previously registered handler
  - `commander.clearDialogHandlers()` — remove all dialog handlers
  - Auto-dismiss behavior when no handlers are registered (prevents page from freezing)
  - `enableDialogManager` option (default: `true`) to opt out if needed
  - Exports `createDialogManager` for low-level usage
  - 19 new unit tests covering all dialog handling scenarios

- 80ec5f7: Add page-level keyboard interaction support (issue #37)

  Expose keyboard input methods on the commander object, enabling users to press
  keys, type text, and hold modifier keys without accessing the raw page object
  directly. New API: `commander.keyboard.press()`, `commander.keyboard.type()`,
  `commander.keyboard.down()`, `commander.keyboard.up()`, and flat aliases
  `commander.pressKey()`, `commander.typeText()`, `commander.keyDown()`,
  `commander.keyUp()`.

## 0.6.0

### Minor Changes

- 7d83530: Document extensibility escape hatch: `commander.page` and `launchBrowser()` return values expose the raw underlying Playwright/Puppeteer page object as an official mechanism for accessing engine-specific APIs not yet supported by browser-commander (e.g. `page.pdf()`, `page.emulateMedia()`, `page.keyboard`, `page.on('dialog', ...)`). Adds tests verifying `commander.page` is the exact raw page object.

## 0.5.4

### Patch Changes

- e9043cc: Fix normalizeSelector to validate input type and reject arrays

  When `normalizeSelector` receives an invalid type (array, number, or non-text-selector object), it now returns `null` with a warning instead of returning the invalid value unchanged.

  This prevents downstream `querySelectorAll` errors with invalid selector syntax (like trailing commas when arrays are accidentally passed).

  Fixes #23

## 0.5.3

### Patch Changes

- 8b86dd7: Include README.md in npm package

  Added language-specific README.md files for each implementation:
  - js/README.md: JavaScript/npm-specific documentation with installation and API usage
  - rust/README.md: Rust/Cargo-specific documentation
  - Root README.md: Common overview linking to both implementations

  The npm package now includes the JavaScript-specific README.md directly from the js/ directory.

## 0.5.2

### Patch Changes

- 87224ee: Fix package.json path in version-and-commit.mjs for monorepo structure

  The git show command uses repository root paths, not the workflow's working directory. Since this is a monorepo with js/ and rust/ folders, the path must be js/package.json instead of just package.json.

  This was causing "Unexpected end of JSON input" errors when the script tried to read package.json from the repository root (which doesn't exist) instead of js/package.json.

## 0.5.1

### Patch Changes

- 2b22f43: Fix PlaywrightAdapter.evaluateOnPage() to spread multiple arguments correctly

  When using `evaluateOnPage()` with multiple arguments, the arguments are now properly spread to the function in the browser context, matching Puppeteer's behavior.

  Previously, the function would receive the entire array as its first parameter instead of spread arguments, causing issues like invalid selectors when passing selector + array combinations.

## 0.5.0

### Minor Changes

- adfccde: Add Rust implementation with parallel JavaScript codebase reorganization

  This introduces a complete Rust translation of the browser-commander library alongside the existing JavaScript implementation. The codebase is now organized into two parallel structures:
  - `js/` - JavaScript implementation (all existing functionality preserved)
  - `rust/` - New Rust implementation with the same modular architecture

  Key features of the Rust implementation:
  - Unified API across multiple browser engines (chromiumoxide, fantoccini)
  - Core types and traits (constants, engine adapter, logger)
  - Element operations (selectors, visibility, content)
  - User interactions (click, scroll, fill)
  - Browser management (launcher, navigation)
  - General utilities (URL handling, wait operations)
  - High-level DRY utilities
  - Comprehensive test coverage with 106 tests

## 0.4.0

### Minor Changes

- 5af2479: Add support for custom Chrome args in launchBrowser

  Adds a new `args` option to the `launchBrowser` function that allows passing custom Chrome arguments to append to the default `CHROME_ARGS`. This is useful for headless server environments (Docker, CI/CD) that require additional flags like `--no-sandbox`, `--disable-setuid-sandbox`, or `--disable-dev-shm-usage`.

  Usage example:

  ```javascript
  import { launchBrowser } from 'browser-commander';

  const { browser, page } = await launchBrowser({
    engine: 'puppeteer',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  ```

  Fixes #11

## 0.3.0

### Minor Changes

- 03e9ccb: Add isTimeoutError function for detecting timeout errors

  Adds a new `isTimeoutError` function exported from the library that helps detect timeout errors from selector waiting operations. This function is complementary to `isNavigationError` and allows automation loops to handle timeout errors gracefully without crashing.

  Usage example:

  ```javascript
  import { isTimeoutError } from 'browser-commander';

  try {
    await page.waitForSelector('.button');
  } catch (error) {
    if (isTimeoutError(error)) {
      console.log('Timeout occurred, continuing with next item...');
    }
  }
  ```

## 0.2.1

### Patch Changes

- Test patch release

## 0.2.0

### Minor Changes

- 5690786: Add Playwright text selector support and use TIMING constants
  - Add `isPlaywrightTextSelector()` and `parsePlaywrightTextSelector()` functions
  - Update `normalizeSelector()` to convert Playwright text selectors (`:has-text()`, `:text-is()`) to valid CSS selectors
  - Update `withTextSelectorSupport()` to handle both Puppeteer and Playwright text selectors
  - Add `NAVIGATION_TIMEOUT` constant and use it in navigation-manager

## 0.1.1

### Patch Changes

- 3e0a56b: Add CI workflow and development best practices
  - Add GitHub Actions workflow for tests on push and PRs
  - Add changeset configuration for version management
  - Add Prettier for code formatting
  - Add ESLint with Prettier integration
  - Add jscpd for code duplication detection
  - Add Husky pre-commit hooks
  - Add release scripts for automated publishing

All notable changes to this project will be documented in this file.

## 0.1.0

### Minor Changes

- Initial release of browser-commander with unified Playwright and Puppeteer API
