import { TIMING } from '../core/constants.js';
import { isNavigationError } from '../core/navigation-safety.js';
import { getLocatorOrElement } from './locators.js';

/**
 * Check if element is visible
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {string|Object} options.selector - CSS selector or element
 * @returns {Promise<boolean>} - True if visible
 */
export async function isVisible(options = {}) {
  const { page, engine, selector } = options;

  if (!selector) {
    throw new Error('selector is required in options');
  }

  try {
    if (engine === 'playwright') {
      const locator = await getLocatorOrElement({ page, engine, selector });
      try {
        await locator.waitFor({
          state: 'visible',
          timeout: TIMING.VISIBILITY_CHECK_TIMEOUT,
        });
        return true;
      } catch {
        return false;
      }
    } else {
      const element = await getLocatorOrElement({ page, engine, selector });
      if (!element) {
        return false;
      }
      return await page.evaluate(
        (el) => el.offsetWidth > 0 && el.offsetHeight > 0,
        element
      );
    }
  } catch (error) {
    if (isNavigationError(error)) {
      console.log(
        '⚠️  Navigation detected during visibility check, returning false'
      );
      return false;
    }
    throw error;
  }
}

/**
 * Check if element is enabled (not disabled, not loading)
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {string|Object} options.selector - CSS selector or locator
 * @param {Array<string>} options.disabledClasses - Additional CSS classes that indicate disabled state (default: ['magritte-button_loading'])
 * @returns {Promise<boolean>} - True if enabled
 */
export async function isEnabled(options = {}) {
  const {
    page,
    engine,
    selector,
    disabledClasses = ['magritte-button_loading'],
  } = options;

  if (!selector) {
    throw new Error('selector is required in options');
  }

  try {
    if (engine === 'playwright') {
      // For Playwright, use locator API
      const locator =
        typeof selector === 'string'
          ? page.locator(selector).first()
          : selector;
      return await locator.evaluate((el, classes) => {
        const isDisabled =
          el.hasAttribute('disabled') ||
          el.getAttribute('aria-disabled') === 'true' ||
          classes.some((cls) => el.classList.contains(cls));
        return !isDisabled;
      }, disabledClasses);
    } else {
      // For Puppeteer (selector should already be normalized by withTextSelectorSupport wrapper)
      const element = await getLocatorOrElement({ page, engine, selector });
      if (!element) {
        return false;
      }
      return await page.evaluate(
        (el, classes) => {
          const isDisabled =
            el.hasAttribute('disabled') ||
            el.getAttribute('aria-disabled') === 'true' ||
            classes.some((cls) => el.classList.contains(cls));
          return !isDisabled;
        },
        element,
        disabledClasses
      );
    }
  } catch (error) {
    if (isNavigationError(error)) {
      console.log(
        '⚠️  Navigation detected during enabled check, returning false'
      );
    }
    return false;
  }
}

/**
 * Get element count
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {string|Object} options.selector - CSS selector or special text selector
 * @returns {Promise<number>} - Number of matching elements
 */
export async function count(options = {}) {
  const { page, engine, selector } = options;

  if (!selector) {
    throw new Error('selector is required in options');
  }

  try {
    // Handle Puppeteer text selectors
    if (
      engine === 'puppeteer' &&
      typeof selector === 'object' &&
      selector._isPuppeteerTextSelector
    ) {
      const result = await page.evaluate(
        (baseSelector, text, exact) => {
          const elements = Array.from(document.querySelectorAll(baseSelector));
          return elements.filter((el) => {
            const elementText = el.textContent.trim();
            return exact ? elementText === text : elementText.includes(text);
          }).length;
        },
        selector.baseSelector,
        selector.text,
        selector.exact
      );
      return result;
    }

    if (engine === 'playwright') {
      return await page.locator(selector).count();
    } else {
      const elements = await page.$$(selector);
      return elements.length;
    }
  } catch (error) {
    if (isNavigationError(error)) {
      console.log('⚠️  Navigation detected during element count, returning 0');
      return 0;
    }
    throw error;
  }
}
