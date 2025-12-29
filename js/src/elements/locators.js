import { TIMING } from '../core/constants.js';
import { isNavigationError } from '../core/navigation-safety.js';

/**
 * Helper to create Playwright locator from selector string
 * Handles :nth-of-type() pseudo-selectors which don't work in Playwright locators
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.selector - CSS selector
 * @returns {Object} - Playwright locator
 */
export function createPlaywrightLocator(options = {}) {
  const { page, selector } = options;

  if (!selector) {
    throw new Error('selector is required in options');
  }
  // Check if selector has :nth-of-type(n) pattern
  const nthOfTypeMatch = selector.match(/^(.+):nth-of-type\((\d+)\)$/);

  if (nthOfTypeMatch) {
    const baseSelector = nthOfTypeMatch[1];
    const index = parseInt(nthOfTypeMatch[2], 10) - 1; // Convert to 0-based index
    return page.locator(baseSelector).nth(index);
  }

  return page.locator(selector);
}

/**
 * Get locator/element from selector (unified helper for both engines)
 * Does NOT wait - use waitForLocatorOrElement() if you need to wait
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {string|Object} options.selector - CSS selector or element/locator
 * @returns {Promise<Object|null>} - Locator for Playwright, Element for Puppeteer (can be null)
 */
export async function getLocatorOrElement(options = {}) {
  const { page, engine, selector } = options;

  if (!selector) {
    throw new Error('selector is required in options');
  }
  if (typeof selector !== 'string') {
    return selector; // Already a locator/element
  }

  if (engine === 'playwright') {
    return createPlaywrightLocator({ page, selector });
  } else {
    // For Puppeteer, return element (can be null if doesn't exist)
    return await page.$(selector);
  }
}

/**
 * Get locator/element and wait for it to be visible
 * Unified waiting behavior for both engines
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {string|Object} options.selector - CSS selector or existing locator/element
 * @param {number} options.timeout - Timeout in ms (default: TIMING.DEFAULT_TIMEOUT)
 * @param {boolean} options.throwOnNavigation - Whether to throw on navigation error (default: true)
 * @returns {Promise<Object|null>} - Locator for Playwright (first match), Element for Puppeteer, or null on navigation
 * @throws {Error} - If element not found or not visible within timeout (unless navigation error and throwOnNavigation is false)
 */
export async function waitForLocatorOrElement(options = {}) {
  const {
    page,
    engine,
    selector,
    timeout = TIMING.DEFAULT_TIMEOUT,
    throwOnNavigation = true,
  } = options;

  if (!selector) {
    throw new Error('selector is required in options');
  }

  try {
    if (engine === 'playwright') {
      const locator = await getLocatorOrElement({ page, engine, selector });
      // Use .first() to handle multiple matches (Playwright strict mode)
      const firstLocator = locator.first();
      await firstLocator.waitFor({ state: 'visible', timeout });
      return firstLocator;
    } else {
      // Puppeteer: wait for selector to be visible (returns first match by default)
      await page.waitForSelector(selector, { visible: true, timeout });
      const element = await page.$(selector);
      if (!element) {
        throw new Error(`Element not found after waiting: ${selector}`);
      }
      return element;
    }
  } catch (error) {
    if (isNavigationError(error)) {
      console.log(
        '⚠️  Navigation detected during waitForLocatorOrElement, recovering gracefully'
      );
      if (throwOnNavigation) {
        throw error;
      }
      return null;
    }
    throw error;
  }
}

/**
 * Wait for element to be visible (works with existing locatorOrElement)
 * @param {Object} options - Configuration options
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {Object} options.locatorOrElement - Element or locator to wait for
 * @param {number} options.timeout - Timeout in ms (default: TIMING.DEFAULT_TIMEOUT)
 * @returns {Promise<void>}
 */
export async function waitForVisible(options = {}) {
  const {
    engine,
    locatorOrElement,
    timeout = TIMING.DEFAULT_TIMEOUT,
  } = options;

  if (!locatorOrElement) {
    throw new Error('locatorOrElement is required in options');
  }

  if (engine === 'playwright') {
    await locatorOrElement.waitFor({ state: 'visible', timeout });
  } else {
    // For Puppeteer, element is already fetched, just verify it exists
    if (!locatorOrElement) {
      throw new Error('Element not found');
    }
  }
}

/**
 * Create locator (Playwright-style fluent API)
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {string} options.selector - CSS selector
 * @returns {Object} - Locator object (Playwright) or wrapper (Puppeteer)
 */
export function locator(options = {}) {
  const { page, engine, selector } = options;

  if (!selector) {
    throw new Error('selector is required in options');
  }

  if (engine === 'playwright') {
    return createPlaywrightLocator({ page, selector });
  } else {
    // Return a wrapper that mimics Playwright locator API for Puppeteer
    const createLocatorWrapper = (sel) => ({
      selector: sel,
      async count() {
        const elements = await page.$$(sel);
        return elements.length;
      },
      async click(options = {}) {
        await page.click(sel, options);
      },
      async fill(text) {
        await page.$eval(
          sel,
          (el, value) => {
            el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          },
          text
        );
      },
      async type(text, options = {}) {
        await page.type(sel, text, options);
      },
      async textContent() {
        const element = await page.$(sel);
        if (!element) {
          return null;
        }
        return await page.evaluate((el) => el.textContent, element);
      },
      async inputValue() {
        const element = await page.$(sel);
        if (!element) {
          return '';
        }
        return await page.evaluate((el) => el.value, element);
      },
      async getAttribute(name) {
        const element = await page.$(sel);
        if (!element) {
          return null;
        }
        return await page.evaluate(
          (el, attr) => el.getAttribute(attr),
          element,
          name
        );
      },
      async isVisible() {
        const element = await page.$(sel);
        if (!element) {
          return false;
        }
        return await page.evaluate(
          (el) => el.offsetWidth > 0 && el.offsetHeight > 0,
          element
        );
      },
      async waitFor(options = {}) {
        const { state = 'visible', timeout = TIMING.DEFAULT_TIMEOUT } = options;
        const visible = state === 'visible';
        await page.waitForSelector(sel, { visible, timeout });
      },
      nth(index) {
        return createLocatorWrapper(`${sel}:nth-of-type(${index + 1})`);
      },
      first() {
        return createLocatorWrapper(`${sel}:nth-of-type(1)`);
      },
      last() {
        return createLocatorWrapper(`${sel}:last-of-type`);
      },
      async evaluate(fn, arg) {
        const element = await page.$(sel);
        if (!element) {
          throw new Error(`Element not found: ${sel}`);
        }
        return await page.evaluate(fn, element, arg);
      },
    });

    return createLocatorWrapper(selector);
  }
}
