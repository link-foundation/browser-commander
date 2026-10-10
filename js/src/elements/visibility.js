import { TIMING } from '../core/constants.js';
import { isNavigationError } from '../core/navigation-safety.js';
import { getLocatorOrElement, requireSelector } from './locators.js';

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

  requireSelector(selector);

  try {
    if (engine === 'playwright') {
      const locator = await getLocatorOrElement(options);
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
      const element = await getLocatorOrElement(options);
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
 * @param {Array<string>} options.disabledClasses - Additional CSS classes that indicate disabled state (default: ['disabled'])
 * @returns {Promise<boolean>} - True if enabled
 */
export async function isEnabled(options = {}) {
  const { page, engine, selector, disabledClasses = ['disabled'] } = options;

  requireSelector(selector);

  try {
    if (engine === 'playwright') {
      // For Playwright, use locator API
      const locator =
        typeof selector === 'string'
          ? (await getLocatorOrElement(options)).first()
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
      const element = await getLocatorOrElement(options);
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

  requireSelector(selector);

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
    if (engine === 'selenium' && selector?._isPuppeteerTextSelector) {
      // The WebDriverPage facade evaluates like a Puppeteer page (issue #104).
      return await count({ ...options, engine: 'puppeteer' });
    }

    if (engine === 'playwright') {
      if (options.visible) {
        return await page
          .locator(selector)
          .evaluateAll(
            (elements) =>
              elements.filter(
                (element) =>
                  element.getClientRects().length > 0 &&
                  element.checkVisibility({ visibilityProperty: true })
              ).length
          );
      }
      return await page.locator(selector).count();
    } else {
      const elements = await page.$$(selector);
      if (options.visible) {
        let visible = 0;
        for (const element of elements) {
          if (
            await page.evaluate(
              (element) =>
                element.getClientRects().length > 0 &&
                element.checkVisibility({ visibilityProperty: true }),
              element
            )
          ) {
            visible += 1;
          }
        }
        return visible;
      }
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
