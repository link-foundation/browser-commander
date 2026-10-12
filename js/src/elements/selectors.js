import {
  isNavigationError,
  waitNavigationState,
  recoverWaitError,
} from '../core/navigation-safety.js';
import { createPlaywrightLocator, requireSelector } from './locators.js';
import { textSelectorInPage } from './text-selector.js';

/**
 * Query single element
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {string} options.selector - CSS selector
 * @returns {Promise<Object|null>} - Element handle or null
 */
export function querySelector(options = {}) {
  return queryElements(options, true);
}

/** Return every matching element with the same navigation recovery as querySelector. */
export function querySelectorAll(options = {}) {
  return queryElements(options, false);
}

async function queryElements(options, single) {
  requireSelector(options.selector);
  const { page, engine, selector } = options;
  try {
    if (engine !== 'playwright') {
      return single ? await page.$(selector) : await page.$$(selector);
    }
    const matching = createPlaywrightLocator({ page, selector });
    const locator = single ? matching.first() : matching;
    const total = await locator.count();
    return single
      ? total > 0
        ? locator
        : null
      : Array.from({ length: total }, (_, index) => locator.nth(index));
  } catch (error) {
    if (!isNavigationError(error)) {
      throw error;
    }
    console.log(
      `⚠️  Navigation detected during ${single ? 'querySelector' : 'querySelectorAll'}, recovering gracefully`
    );
    return single ? null : [];
  }
}

/**
 * Find elements by text content (works across both engines)
 * @param {Object} options - Configuration options
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {string} options.text - Text to search for
 * @param {string} options.selector - Optional base selector (e.g., 'button', 'a', 'span')
 * @param {boolean} options.exact - Exact match vs contains (default: false)
 * @returns {Promise<string>} - CSS selector that can be used with other commander methods
 */
export async function findByText(options = {}) {
  const { engine, text, selector = '*', exact = false } = options;

  if (!text) {
    throw new Error('text is required in options');
  }

  if (engine === 'playwright') {
    // Playwright supports :has-text() natively
    const textSelector = exact ? `:text-is("${text}")` : `:has-text("${text}")`;
    return await Promise.resolve(`${selector}${textSelector}`);
  } else {
    // For Puppeteer, we need to use XPath or evaluate
    // Return a special selector marker that will be handled by other methods
    return await Promise.resolve({
      _isPuppeteerTextSelector: true,
      baseSelector: selector,
      text,
      exact,
    });
  }
}

/**
 * Normalize selector to handle both Puppeteer and Playwright text selectors
 * Preserves native Playwright strings; resolves text objects to unique CSS paths.
 *
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {string|Object} options.selector - CSS selector or text selector object
 * @returns {Promise<string|null>} - Native selector, unique CSS path, or null
 */
export async function normalizeSelector(options = {}) {
  const { page, selector } = options;

  requireSelector(selector);

  // DEFENSIVE: Validate selector type - must be string or Puppeteer text selector object
  // Arrays and other invalid types should be rejected to prevent downstream querySelectorAll errors
  if (Array.isArray(selector)) {
    console.warn(
      `normalizeSelector received invalid selector type: array. Expected string or text selector object.`
    );
    return null;
  }

  if (
    typeof selector !== 'string' &&
    (typeof selector !== 'object' || !selector._isPuppeteerTextSelector)
  ) {
    console.warn(
      `normalizeSelector received invalid selector type: ${typeof selector}. Expected string or text selector object.`
    );
    return null;
  }

  // Plain string selector - return as-is
  if (typeof selector === 'string') {
    return selector;
  }

  // Handle Puppeteer text selector objects
  if (selector._isPuppeteerTextSelector) {
    try {
      // Find element by text and generate a unique selector
      const result = await page.evaluate(textSelectorInPage, {
        baseSelector: selector.baseSelector,
        text: selector.text,
        exact: selector.exact,
      });

      return result;
    } catch (error) {
      if (isNavigationError(error)) {
        console.log(
          '⚠️  Navigation detected during normalizeSelector (Puppeteer), returning null'
        );
        return null;
      }
      throw error;
    }
  }

  // This line should be unreachable after validation, but kept as a safeguard
  // istanbul ignore next
  return selector;
}

/**
 * Enhanced wrapper for functions that need to handle text selectors
 * @param {Function} fn - The function to wrap
 * @param {string} engine - Engine type ('playwright' or 'puppeteer')
 * @param {Object} page - Browser page object
 * @returns {Function} - Wrapped function
 */
export function withTextSelectorSupport(fn, engine, page) {
  return async (options = {}) => {
    let { selector } = options;

    // Normalize Puppeteer-style text selectors (object format; Puppeteer and
    // selenium)
    if (
      engine !== 'playwright' &&
      selector &&
      typeof selector === 'object' &&
      selector._isPuppeteerTextSelector
    ) {
      selector = await normalizeSelector({ page, engine, selector });
      if (!selector) {
        throw new Error('Element with specified text not found');
      }
    }

    return fn({ ...options, selector });
  };
}

/**
 * Wait for selector to appear
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {string} options.selector - CSS selector
 * @param {boolean} options.visible - Wait for visibility (default: true)
 * @param {number} options.timeout - Timeout in ms (default: TIMING.DEFAULT_TIMEOUT)
 * @param {boolean} options.throwOnNavigation - Throw on navigation error (default: true)
 * @returns {Promise<boolean>} - True if selector found, false on navigation
 */
export async function waitForSelector(options = {}) {
  const { page, engine, selector, visible = true, timeout = 5000 } = options;

  requireSelector(selector);

  const initial = waitNavigationState(page, options.navigationManager);
  try {
    if (engine === 'playwright') {
      const locator = createPlaywrightLocator({ page, selector });
      await locator.waitFor({
        state: visible ? 'visible' : 'attached',
        timeout,
      });
    } else {
      await page.waitForSelector(selector, { visible, timeout });
    }
    return true;
  } catch (caught) {
    return recoverWaitError(caught, options, initial, 'waitForSelector', false);
  }
}
