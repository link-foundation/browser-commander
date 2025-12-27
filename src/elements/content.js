import { isNavigationError } from '../core/navigation-safety.js';
import { getLocatorOrElement } from './locators.js';
import { createEngineAdapter } from '../core/engine-adapter.js';

/**
 * Get text content
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {string|Object} options.selector - CSS selector or element
 * @param {Object} options.adapter - Engine adapter (optional, will be created if not provided)
 * @returns {Promise<string|null>} - Text content or null
 */
export async function textContent(options = {}) {
  const { page, engine, selector, adapter: providedAdapter } = options;

  if (!selector) {
    throw new Error('selector is required in options');
  }

  try {
    const adapter = providedAdapter || createEngineAdapter(page, engine);
    const locatorOrElement = await getLocatorOrElement({
      page,
      engine,
      selector,
    });
    if (!locatorOrElement) {
      return null;
    }
    return await adapter.getTextContent(locatorOrElement);
  } catch (error) {
    if (isNavigationError(error)) {
      console.log('⚠️  Navigation detected during textContent, returning null');
      return null;
    }
    throw error;
  }
}

/**
 * Get input value
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {string|Object} options.selector - CSS selector or element
 * @param {Object} options.adapter - Engine adapter (optional, will be created if not provided)
 * @returns {Promise<string>} - Input value
 */
export async function inputValue(options = {}) {
  const { page, engine, selector, adapter: providedAdapter } = options;

  if (!selector) {
    throw new Error('selector is required in options');
  }

  try {
    const adapter = providedAdapter || createEngineAdapter(page, engine);
    const locatorOrElement = await getLocatorOrElement({
      page,
      engine,
      selector,
    });
    if (!locatorOrElement) {
      return '';
    }
    return await adapter.getInputValue(locatorOrElement);
  } catch (error) {
    if (isNavigationError(error)) {
      console.log(
        '⚠️  Navigation detected during inputValue, returning empty string'
      );
      return '';
    }
    throw error;
  }
}

/**
 * Get element attribute
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {string|Object} options.selector - CSS selector or element
 * @param {string} options.attribute - Attribute name
 * @param {Object} options.adapter - Engine adapter (optional, will be created if not provided)
 * @returns {Promise<string|null>} - Attribute value or null
 */
export async function getAttribute(options = {}) {
  const {
    page,
    engine,
    selector,
    attribute,
    adapter: providedAdapter,
  } = options;

  if (!selector || !attribute) {
    throw new Error('selector and attribute are required in options');
  }

  try {
    const adapter = providedAdapter || createEngineAdapter(page, engine);
    const locatorOrElement = await getLocatorOrElement({
      page,
      engine,
      selector,
    });
    if (!locatorOrElement) {
      return null;
    }
    return await adapter.getAttribute(locatorOrElement, attribute);
  } catch (error) {
    if (isNavigationError(error)) {
      console.log(
        '⚠️  Navigation detected during getAttribute, returning null'
      );
      return null;
    }
    throw error;
  }
}

/**
 * Get input value from element (helper)
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {Object} options.locatorOrElement - Element or locator
 * @param {Object} options.adapter - Engine adapter (optional, will be created if not provided)
 * @returns {Promise<string>}
 */
export async function getInputValue(options = {}) {
  const { page, engine, locatorOrElement, adapter: providedAdapter } = options;

  if (!locatorOrElement) {
    throw new Error('locatorOrElement is required in options');
  }

  try {
    const adapter = providedAdapter || createEngineAdapter(page, engine);
    return await adapter.getInputValue(locatorOrElement);
  } catch (error) {
    if (isNavigationError(error)) {
      console.log(
        '⚠️  Navigation detected during getInputValue, returning empty string'
      );
      return '';
    }
    throw error;
  }
}

/**
 * Log element information for verbose debugging
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {Function} options.log - Logger instance
 * @param {Object} options.locatorOrElement - Element or locator to log
 * @param {Object} options.adapter - Engine adapter (optional, will be created if not provided)
 * @returns {Promise<void>}
 */
export async function logElementInfo(options = {}) {
  const {
    page,
    engine,
    log,
    locatorOrElement,
    adapter: providedAdapter,
  } = options;

  if (!locatorOrElement) {
    return;
  }

  try {
    const adapter = providedAdapter || createEngineAdapter(page, engine);
    const tagName = await adapter.evaluateOnElement(
      locatorOrElement,
      (el) => el.tagName
    );
    const text = await adapter.getTextContent(locatorOrElement);
    log.debug(
      () =>
        `🔍 [VERBOSE] Target element: ${tagName}: "${text?.trim().substring(0, 30)}..."`
    );
  } catch (error) {
    if (isNavigationError(error)) {
      log.debug(
        () => '⚠️  Navigation detected during logElementInfo, skipping'
      );
      return;
    }
    throw error;
  }
}
