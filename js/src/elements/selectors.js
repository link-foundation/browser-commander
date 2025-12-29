import { isNavigationError } from '../core/navigation-safety.js';
import { createPlaywrightLocator } from './locators.js';

/**
 * Query single element
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {string} options.selector - CSS selector
 * @returns {Promise<Object|null>} - Element handle or null
 */
export async function querySelector(options = {}) {
  const { page, engine, selector } = options;

  if (!selector) {
    throw new Error('selector is required in options');
  }

  try {
    if (engine === 'playwright') {
      const locator = createPlaywrightLocator({ page, selector }).first();
      const count = await locator.count();
      return count > 0 ? locator : null;
    } else {
      return await page.$(selector);
    }
  } catch (error) {
    if (isNavigationError(error)) {
      console.log(
        '⚠️  Navigation detected during querySelector, returning null'
      );
      return null;
    }
    throw error;
  }
}

/**
 * Query all elements
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {string} options.selector - CSS selector
 * @returns {Promise<Array>} - Array of element handles
 */
export async function querySelectorAll(options = {}) {
  const { page, engine, selector } = options;

  if (!selector) {
    throw new Error('selector is required in options');
  }

  try {
    if (engine === 'playwright') {
      const locator = createPlaywrightLocator({ page, selector });
      const count = await locator.count();
      const elements = [];
      for (let i = 0; i < count; i++) {
        elements.push(locator.nth(i));
      }
      return elements;
    } else {
      return await page.$$(selector);
    }
  } catch (error) {
    if (isNavigationError(error)) {
      console.log(
        '⚠️  Navigation detected during querySelectorAll, returning empty array'
      );
      return [];
    }
    throw error;
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
    return `${selector}${textSelector}`;
  } else {
    // For Puppeteer, we need to use XPath or evaluate
    // Return a special selector marker that will be handled by other methods
    return {
      _isPuppeteerTextSelector: true,
      baseSelector: selector,
      text,
      exact,
    };
  }
}

/**
 * Check if a selector is a Playwright-specific text selector
 * @param {string} selector - The selector to check
 * @returns {boolean} - True if selector contains Playwright text pseudo-selectors
 */
function isPlaywrightTextSelector(selector) {
  if (typeof selector !== 'string') {
    return false;
  }
  return selector.includes(':has-text(') || selector.includes(':text-is(');
}

/**
 * Parse a Playwright text selector to extract base selector and text
 * @param {string} selector - Playwright text selector like 'a:has-text("text")'
 * @returns {Object|null} - { baseSelector, text, exact } or null if not parseable
 */
function parsePlaywrightTextSelector(selector) {
  // Match patterns like 'a:has-text("text")' or 'button:text-is("exact text")'
  const hasTextMatch = selector.match(/^(.+?):has-text\("(.+?)"\)$/);
  if (hasTextMatch) {
    return {
      baseSelector: hasTextMatch[1],
      text: hasTextMatch[2],
      exact: false,
    };
  }

  const textIsMatch = selector.match(/^(.+?):text-is\("(.+?)"\)$/);
  if (textIsMatch) {
    return {
      baseSelector: textIsMatch[1],
      text: textIsMatch[2],
      exact: true,
    };
  }

  return null;
}

/**
 * Normalize selector to handle both Puppeteer and Playwright text selectors
 * Converts engine-specific text selectors to valid CSS selectors for browser context
 *
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {string|Object} options.selector - CSS selector or text selector object
 * @returns {Promise<string|null>} - Valid CSS selector or null if not found
 */
export async function normalizeSelector(options = {}) {
  const { page, engine, selector } = options;

  if (!selector) {
    throw new Error('selector is required in options');
  }

  // Handle Playwright text selectors (strings containing :has-text or :text-is)
  // These are valid for Playwright's locator API but NOT for document.querySelectorAll
  if (
    typeof selector === 'string' &&
    engine === 'playwright' &&
    isPlaywrightTextSelector(selector)
  ) {
    const parsed = parsePlaywrightTextSelector(selector);
    if (!parsed) {
      // Could not parse, return as-is and hope for the best
      return selector;
    }

    try {
      // Use page.evaluate to find matching element and generate a valid CSS selector
      const result = await page.evaluate(({ baseSelector, text, exact }) => {
        const elements = Array.from(document.querySelectorAll(baseSelector));
        const matchingElement = elements.find((el) => {
          const elementText = el.textContent.trim();
          return exact ? elementText === text : elementText.includes(text);
        });

        if (!matchingElement) {
          return null;
        }

        // Generate a unique selector using data-qa or nth-of-type
        const dataQa = matchingElement.getAttribute('data-qa');
        if (dataQa) {
          return `[data-qa="${dataQa}"]`;
        }

        // Use nth-of-type as fallback
        const tagName = matchingElement.tagName.toLowerCase();
        const siblings = Array.from(
          matchingElement.parentElement.children
        ).filter((el) => el.tagName.toLowerCase() === tagName);
        const index = siblings.indexOf(matchingElement);
        return `${tagName}:nth-of-type(${index + 1})`;
      }, parsed);

      return result;
    } catch (error) {
      if (isNavigationError(error)) {
        console.log(
          '⚠️  Navigation detected during normalizeSelector (Playwright), returning null'
        );
        return null;
      }
      throw error;
    }
  }

  // Plain string selector - return as-is
  if (typeof selector === 'string') {
    return selector;
  }

  // Handle Puppeteer text selector objects
  if (selector._isPuppeteerTextSelector) {
    try {
      // Find element by text and generate a unique selector
      const result = await page.evaluate(
        (baseSelector, text, exact) => {
          const elements = Array.from(document.querySelectorAll(baseSelector));
          const matchingElement = elements.find((el) => {
            const elementText = el.textContent.trim();
            return exact ? elementText === text : elementText.includes(text);
          });

          if (!matchingElement) {
            return null;
          }

          // Generate a unique selector using data-qa or nth-of-type
          const dataQa = matchingElement.getAttribute('data-qa');
          if (dataQa) {
            return `[data-qa="${dataQa}"]`;
          }

          // Use nth-of-type as fallback
          const tagName = matchingElement.tagName.toLowerCase();
          const siblings = Array.from(
            matchingElement.parentElement.children
          ).filter((el) => el.tagName.toLowerCase() === tagName);
          const index = siblings.indexOf(matchingElement);
          return `${tagName}:nth-of-type(${index + 1})`;
        },
        selector.baseSelector,
        selector.text,
        selector.exact
      );

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

    // Normalize Puppeteer text selectors (object format)
    if (
      engine === 'puppeteer' &&
      typeof selector === 'object' &&
      selector._isPuppeteerTextSelector
    ) {
      selector = await normalizeSelector({ page, engine, selector });
      if (!selector) {
        throw new Error('Element with specified text not found');
      }
    }

    // Normalize Playwright text selectors (string format with :has-text or :text-is)
    if (
      engine === 'playwright' &&
      typeof selector === 'string' &&
      isPlaywrightTextSelector(selector)
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
  const {
    page,
    engine,
    selector,
    visible = true,
    timeout = 5000,
    throwOnNavigation = true,
  } = options;

  if (!selector) {
    throw new Error('selector is required in options');
  }

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
  } catch (error) {
    if (isNavigationError(error)) {
      console.log(
        '⚠️  Navigation detected during waitForSelector, recovering gracefully'
      );
      if (throwOnNavigation) {
        throw error;
      }
      return false;
    }
    throw error;
  }
}
