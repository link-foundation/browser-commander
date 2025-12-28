# Changelog

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
