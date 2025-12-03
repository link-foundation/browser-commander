import { TIMING } from '../core/constants.js';
import { isNavigationError } from '../core/navigation-safety.js';
import { waitForLocatorOrElement } from '../elements/locators.js';
import { scrollIntoViewIfNeeded } from './scroll.js';
import { clickElement } from './click.js';
import { getInputValue } from '../elements/content.js';
import { createEngineAdapter } from '../core/engine-adapter.js';

/**
 * Default verification function for fill operations.
 * Verifies that the filled text matches expected text.
 * @param {Object} options - Verification options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {Object} options.locatorOrElement - Element that was filled
 * @param {string} options.expectedText - Text that should be in the element
 * @returns {Promise<{verified: boolean, actualValue: string}>}
 */
export async function defaultFillVerification(options = {}) {
  const { page, engine, locatorOrElement, expectedText } = options;

  try {
    const actualValue = await getInputValue({ page, engine, locatorOrElement });
    // Verify that the value contains the expected text (handles cases where value may have formatting)
    const verified = actualValue === expectedText || actualValue.includes(expectedText);
    return { verified, actualValue };
  } catch (error) {
    if (isNavigationError(error)) {
      return { verified: false, actualValue: '', navigationError: true };
    }
    throw error;
  }
}

/**
 * Verify fill operation with retry logic
 * @param {Object} options - Verification options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type
 * @param {Object} options.locatorOrElement - Element to verify
 * @param {string} options.expectedText - Expected text value
 * @param {Function} options.verifyFn - Custom verification function (optional, defaults to defaultFillVerification)
 * @param {number} options.timeout - Verification timeout in ms (default: TIMING.VERIFICATION_TIMEOUT)
 * @param {number} options.retryInterval - Interval between retries (default: TIMING.VERIFICATION_RETRY_INTERVAL)
 * @param {Function} options.log - Logger instance
 * @returns {Promise<{verified: boolean, actualValue: string, attempts: number}>}
 */
export async function verifyFill(options = {}) {
  const {
    page,
    engine,
    locatorOrElement,
    expectedText,
    verifyFn = defaultFillVerification,
    timeout = TIMING.VERIFICATION_TIMEOUT,
    retryInterval = TIMING.VERIFICATION_RETRY_INTERVAL,
    log = { debug: () => {} },
  } = options;

  const startTime = Date.now();
  let attempts = 0;
  let lastResult = { verified: false, actualValue: '' };

  while (Date.now() - startTime < timeout) {
    attempts++;
    lastResult = await verifyFn({
      page,
      engine,
      locatorOrElement,
      expectedText,
    });

    if (lastResult.verified) {
      log.debug(() => `✅ Fill verification succeeded after ${attempts} attempt(s)`);
      return { ...lastResult, attempts };
    }

    if (lastResult.navigationError) {
      log.debug(() => '⚠️  Navigation detected during fill verification');
      return { ...lastResult, attempts };
    }

    // Wait before next retry
    await new Promise(resolve => setTimeout(resolve, retryInterval));
  }

  log.debug(() => `❌ Fill verification failed after ${attempts} attempts. Expected: "${expectedText}", Got: "${lastResult.actualValue}"`);
  return { ...lastResult, attempts };
}

/**
 * Check if an input element is empty
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {Object} options.locatorOrElement - Element or locator to check
 * @param {Object} options.adapter - Engine adapter (optional, will be created if not provided)
 * @returns {Promise<boolean>} - True if empty, false if has content (returns true on navigation)
 */
export async function checkIfElementEmpty(options = {}) {
  const { page, engine, locatorOrElement, adapter: providedAdapter } = options;

  if (!locatorOrElement) {
    throw new Error('locatorOrElement is required in options');
  }

  // Add defensive check for page parameter
  if (!page && !providedAdapter) {
    const availableKeys = Object.keys(options).join(', ');
    throw new Error(`checkIfElementEmpty: page is required in options when adapter is not provided. Available option keys: [${availableKeys}]. This indicates the 'page' parameter was not passed correctly from the calling function.`);
  }

  try {
    const adapter = providedAdapter || createEngineAdapter(page, engine);
    const currentValue = await adapter.getInputValue(locatorOrElement);
    return !currentValue || currentValue.trim() === '';
  } catch (error) {
    if (isNavigationError(error)) {
      console.log('⚠️  Navigation detected during checkIfElementEmpty, returning true');
      return true;
    }
    throw error;
  }
}

/**
 * Perform fill/type operation on an element (low-level)
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {Object} options.locatorOrElement - Element or locator to fill
 * @param {string} options.text - Text to fill
 * @param {boolean} options.simulateTyping - Whether to simulate typing (default: true)
 * @param {boolean} options.verify - Whether to verify the fill operation (default: true)
 * @param {Function} options.verifyFn - Custom verification function (optional)
 * @param {number} options.verificationTimeout - Verification timeout in ms (default: TIMING.VERIFICATION_TIMEOUT)
 * @param {Function} options.log - Logger instance (optional)
 * @param {Object} options.adapter - Engine adapter (optional, will be created if not provided)
 * @returns {Promise<{filled: boolean, verified: boolean, actualValue?: string}>}
 */
export async function performFill(options = {}) {
  const {
    page,
    engine,
    locatorOrElement,
    text,
    simulateTyping = true,
    verify = true,
    verifyFn,
    verificationTimeout = TIMING.VERIFICATION_TIMEOUT,
    log = { debug: () => {} },
    adapter: providedAdapter,
  } = options;

  if (!text) {
    throw new Error('text is required in options');
  }

  if (!locatorOrElement) {
    throw new Error('locatorOrElement is required in options');
  }

  // Add defensive check for page parameter
  if (!page && !providedAdapter) {
    const availableKeys = Object.keys(options).join(', ');
    throw new Error(`performFill: page is required in options when adapter is not provided. Available option keys: [${availableKeys}]. This indicates the 'page' parameter was not passed correctly from the calling function.`);
  }

  try {
    const adapter = providedAdapter || createEngineAdapter(page, engine);
    if (simulateTyping) {
      await adapter.type(locatorOrElement, text);
    } else {
      await adapter.fill(locatorOrElement, text);
    }

    // Verify fill if requested
    if (verify) {
      const verificationResult = await verifyFill({
        page,
        engine,
        locatorOrElement,
        expectedText: text,
        verifyFn,
        timeout: verificationTimeout,
        log,
      });

      if (!verificationResult.verified) {
        log.debug(() => `⚠️  Fill verification failed: expected "${text}", got "${verificationResult.actualValue}"`);
      }

      return {
        filled: true,
        verified: verificationResult.verified,
        actualValue: verificationResult.actualValue,
      };
    }

    return { filled: true, verified: true };
  } catch (error) {
    if (isNavigationError(error)) {
      console.log('⚠️  Navigation detected during performFill, recovering gracefully');
      return { filled: false, verified: false };
    }
    throw error;
  }
}

/**
 * Fill a textarea with text (high-level with checks and scrolling)
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {Function} options.wait - Wait function
 * @param {Function} options.log - Logger instance
 * @param {string|Object} options.selector - CSS selector or Playwright Locator
 * @param {string} options.text - Text to fill
 * @param {boolean} options.checkEmpty - Only fill if empty (default: true)
 * @param {boolean} options.scrollIntoView - Scroll into view (default: true)
 * @param {boolean} options.simulateTyping - Simulate typing vs direct fill (default: true)
 * @param {number} options.timeout - Timeout in ms (default: TIMING.DEFAULT_TIMEOUT)
 * @param {boolean} options.verify - Whether to verify the fill operation (default: true)
 * @param {Function} options.verifyFn - Custom verification function (optional, uses defaultFillVerification if not provided)
 * @param {number} options.verificationTimeout - Verification timeout in ms (default: TIMING.VERIFICATION_TIMEOUT)
 * @returns {Promise<{filled: boolean, verified: boolean, skipped: boolean, actualValue?: string}>}
 *   - filled: true if fill operation was attempted
 *   - verified: true if fill was verified successfully (only meaningful if filled is true)
 *   - skipped: true if element already had content and checkEmpty was true
 * @throws {Error} - If selector or text is missing, or if operation fails (except navigation)
 */
export async function fillTextArea(options = {}) {
  const {
    page,
    engine,
    wait,
    log,
    selector,
    text,
    checkEmpty = true,
    scrollIntoView: shouldScroll = true,
    simulateTyping = true,
    timeout = TIMING.DEFAULT_TIMEOUT,
    verify = true,
    verifyFn,
    verificationTimeout = TIMING.VERIFICATION_TIMEOUT,
  } = options;

  // Defensive check: Validate that page parameter is present
  if (!page) {
    const availableKeys = Object.keys(options).join(', ');
    throw new Error(`fillTextArea: page is required in options. Available option keys: [${availableKeys}]. This indicates the 'page' parameter was not passed correctly from the calling function (bindings layer).`);
  }

  if (!selector || !text) {
    throw new Error('fillTextArea: selector and text are required in options');
  }

  try {
    // Get locator/element and wait for it to be visible (unified for both engines)
    const locatorOrElement = await waitForLocatorOrElement({ page, engine, selector, timeout });

    // Check if empty (if requested)
    if (checkEmpty) {
      const isEmpty = await checkIfElementEmpty({ page, engine, locatorOrElement });
      if (!isEmpty) {
        const currentValue = await getInputValue({ page, engine, locatorOrElement });
        log.debug(() => `🔍 [VERBOSE] Textarea already has content, skipping: "${currentValue.substring(0, 30)}..."`);
        return { filled: false, verified: false, skipped: true, actualValue: currentValue };
      }
    }

    // Scroll into view (if requested and needed)
    if (shouldScroll) {
      await scrollIntoViewIfNeeded({ page, engine, wait, log, locatorOrElement, behavior: 'smooth' });
    }

    // Click the element (prevent auto-scroll if scrollIntoView is disabled)
    const clicked = await clickElement({ page, engine, log, locatorOrElement, noAutoScroll: !shouldScroll });
    if (!clicked) {
      return { filled: false, verified: false, skipped: false }; // Navigation occurred
    }

    // Fill the text with verification
    const fillResult = await performFill({
      page,
      engine,
      locatorOrElement,
      text,
      simulateTyping,
      verify,
      verifyFn,
      verificationTimeout,
      log,
    });

    if (!fillResult.filled) {
      return { filled: false, verified: false, skipped: false }; // Navigation occurred
    }

    log.debug(() => `🔍 [VERBOSE] Filled textarea with text: "${text.substring(0, 50)}..."`);

    if (fillResult.verified) {
      log.debug(() => `✅ Fill verification passed`);
    } else {
      log.debug(() => `⚠️  Fill verification failed: expected "${text}", got "${fillResult.actualValue}"`);
    }

    return {
      filled: true,
      verified: fillResult.verified,
      skipped: false,
      actualValue: fillResult.actualValue,
    };
  } catch (error) {
    if (isNavigationError(error)) {
      console.log('⚠️  Navigation detected during fillTextArea, recovering gracefully');
      return { filled: false, verified: false, skipped: false };
    }
    throw error;
  }
}
