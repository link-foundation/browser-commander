import { TIMING } from '../core/constants.js';
import { isNavigationError } from '../core/navigation-safety.js';
import { isActionStoppedError } from '../core/page-trigger-manager.js';

// Shared evaluation function for checking if scrolling is needed
const needsScrollingFn = (el, thresholdPercent) => {
  const rect = el.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const elementCenter = rect.top + rect.height / 2;
  const viewportCenter = viewportHeight / 2;
  const distanceFromCenter = Math.abs(elementCenter - viewportCenter);
  const thresholdPixels = (viewportHeight * thresholdPercent) / 100;

  // Check if element is visible and within threshold
  const isVisible = rect.top >= 0 && rect.bottom <= viewportHeight;
  const isWithinThreshold = distanceFromCenter <= thresholdPixels;

  return !isVisible || !isWithinThreshold;
};

// Shared evaluation function for verifying element is in viewport
const isElementInViewportFn = (el, margin = 50) => {
  const rect = el.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;

  // Check if element is at least partially visible with some margin
  const isInVerticalView = rect.top < (viewportHeight - margin) && rect.bottom > margin;
  const isInHorizontalView = rect.left < (viewportWidth - margin) && rect.right > margin;

  return isInVerticalView && isInHorizontalView;
};

/**
 * Default verification function for scroll operations.
 * Verifies that the element is now visible in the viewport.
 * @param {Object} options - Verification options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {Object} options.locatorOrElement - Element that was scrolled to
 * @param {number} options.margin - Margin in pixels to consider element visible (default: 50)
 * @returns {Promise<{verified: boolean, inViewport: boolean}>}
 */
export async function defaultScrollVerification(options = {}) {
  const { page, engine, locatorOrElement, margin = 50 } = options;

  try {
    let inViewport;
    if (engine === 'playwright') {
      inViewport = await locatorOrElement.evaluate(isElementInViewportFn, margin);
    } else {
      inViewport = await page.evaluate(isElementInViewportFn, locatorOrElement, margin);
    }
    return { verified: inViewport, inViewport };
  } catch (error) {
    if (isNavigationError(error) || isActionStoppedError(error)) {
      return { verified: false, inViewport: false, navigationError: true };
    }
    throw error;
  }
}

/**
 * Verify scroll operation with retry logic
 * @param {Object} options - Verification options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type
 * @param {Object} options.locatorOrElement - Element to verify
 * @param {Function} options.verifyFn - Custom verification function (optional, defaults to defaultScrollVerification)
 * @param {number} options.timeout - Verification timeout in ms (default: TIMING.VERIFICATION_TIMEOUT)
 * @param {number} options.retryInterval - Interval between retries (default: TIMING.VERIFICATION_RETRY_INTERVAL)
 * @param {Function} options.log - Logger instance
 * @returns {Promise<{verified: boolean, inViewport: boolean, attempts: number}>}
 */
export async function verifyScroll(options = {}) {
  const {
    page,
    engine,
    locatorOrElement,
    verifyFn = defaultScrollVerification,
    timeout = TIMING.VERIFICATION_TIMEOUT,
    retryInterval = TIMING.VERIFICATION_RETRY_INTERVAL,
    log = { debug: () => {} },
  } = options;

  const startTime = Date.now();
  let attempts = 0;
  let lastResult = { verified: false, inViewport: false };

  while (Date.now() - startTime < timeout) {
    attempts++;
    lastResult = await verifyFn({
      page,
      engine,
      locatorOrElement,
    });

    if (lastResult.verified) {
      log.debug(() => `✅ Scroll verification succeeded after ${attempts} attempt(s)`);
      return { ...lastResult, attempts };
    }

    if (lastResult.navigationError) {
      log.debug(() => '⚠️  Navigation/stop detected during scroll verification');
      return { ...lastResult, attempts };
    }

    // Wait before next retry
    await new Promise(resolve => setTimeout(resolve, retryInterval));
  }

  log.debug(() => `❌ Scroll verification failed after ${attempts} attempts - element not in viewport`);
  return { ...lastResult, attempts };
}

/**
 * Scroll element into view (low-level, does not check if scroll is needed)
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {Object} options.locatorOrElement - Playwright locator or Puppeteer element
 * @param {string} options.behavior - 'smooth' or 'instant' (default: 'smooth')
 * @param {boolean} options.verify - Whether to verify the scroll operation (default: true)
 * @param {Function} options.verifyFn - Custom verification function (optional)
 * @param {number} options.verificationTimeout - Verification timeout in ms (default: TIMING.VERIFICATION_TIMEOUT)
 * @param {Function} options.log - Logger instance (optional)
 * @returns {Promise<{scrolled: boolean, verified: boolean}>}
 */
export async function scrollIntoView(options = {}) {
  const {
    page,
    engine,
    locatorOrElement,
    behavior = 'smooth',
    verify = true,
    verifyFn,
    verificationTimeout = TIMING.VERIFICATION_TIMEOUT,
    log = { debug: () => {} },
  } = options;

  if (!locatorOrElement) {
    throw new Error('locatorOrElement is required in options');
  }

  try {
    if (engine === 'playwright') {
      await locatorOrElement.evaluate((el, scrollBehavior) => {
        el.scrollIntoView({ behavior: scrollBehavior, block: 'center', inline: 'center' });
      }, behavior);
    } else {
      await page.evaluate((el, scrollBehavior) => {
        el.scrollIntoView({ behavior: scrollBehavior, block: 'center', inline: 'center' });
      }, locatorOrElement, behavior);
    }

    // Verify scroll if requested
    if (verify) {
      const verificationResult = await verifyScroll({
        page,
        engine,
        locatorOrElement,
        verifyFn,
        timeout: verificationTimeout,
        log,
      });

      return {
        scrolled: true,
        verified: verificationResult.verified,
      };
    }

    return { scrolled: true, verified: true };
  } catch (error) {
    if (isNavigationError(error) || isActionStoppedError(error)) {
      console.log('⚠️  Navigation/stop detected during scrollIntoView, skipping');
      return { scrolled: false, verified: false };
    }
    throw error;
  }
}

/**
 * Check if element needs scrolling (is it more than threshold% away from viewport center)
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {Object} options.locatorOrElement - Playwright locator or Puppeteer element
 * @param {number} options.threshold - Percentage of viewport height to consider "significant" (default: 10)
 * @returns {Promise<boolean>} - True if scroll is needed, false on navigation/stop
 */
export async function needsScrolling(options = {}) {
  const { page, engine, locatorOrElement, threshold = 10 } = options;

  if (!locatorOrElement) {
    throw new Error('locatorOrElement is required in options');
  }

  try {
    if (engine === 'playwright') {
      return await locatorOrElement.evaluate(needsScrollingFn, threshold);
    } else {
      return await page.evaluate(needsScrollingFn, locatorOrElement, threshold);
    }
  } catch (error) {
    if (isNavigationError(error) || isActionStoppedError(error)) {
      console.log('⚠️  Navigation/stop detected during needsScrolling, returning false');
      return false;
    }
    throw error;
  }
}

/**
 * Scroll element into view only if needed (>threshold% from center)
 * Automatically waits for scroll animation if scroll was performed
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type
 * @param {Function} options.wait - Wait function
 * @param {Function} options.log - Logger instance
 * @param {Object} options.locatorOrElement - Playwright locator or Puppeteer element
 * @param {string} options.behavior - 'smooth' or 'instant' (default: 'smooth')
 * @param {number} options.threshold - Percentage of viewport height to consider "significant" (default: 10)
 * @param {number} options.waitAfterScroll - Wait time after scroll in ms (default: TIMING.SCROLL_ANIMATION_WAIT for smooth, 0 for instant)
 * @param {boolean} options.verify - Whether to verify the scroll operation (default: true)
 * @param {Function} options.verifyFn - Custom verification function (optional)
 * @param {number} options.verificationTimeout - Verification timeout in ms (default: TIMING.VERIFICATION_TIMEOUT)
 * @returns {Promise<{scrolled: boolean, verified: boolean, skipped: boolean}>}
 *   - scrolled: true if scroll was performed
 *   - verified: true if element is confirmed in viewport (only meaningful if scrolled is true)
 *   - skipped: true if element was already in view
 */
export async function scrollIntoViewIfNeeded(options = {}) {
  const {
    page,
    engine,
    wait,
    log,
    locatorOrElement,
    behavior = 'smooth',
    threshold = 10,
    waitAfterScroll = behavior === 'smooth' ? TIMING.SCROLL_ANIMATION_WAIT : 0,
    verify = true,
    verifyFn,
    verificationTimeout = TIMING.VERIFICATION_TIMEOUT,
  } = options;

  if (!locatorOrElement) {
    throw new Error('locatorOrElement is required in options');
  }

  // Check if scrolling is needed
  const needsScroll = await needsScrolling({ page, engine, locatorOrElement, threshold });

  if (!needsScroll) {
    log.debug(() => `🔍 [VERBOSE] Element already in view (within ${threshold}% threshold), skipping scroll`);
    return { scrolled: false, verified: true, skipped: true };
  }

  // Perform scroll with verification
  log.debug(() => `🔍 [VERBOSE] Scrolling with behavior: ${behavior}`);
  const scrollResult = await scrollIntoView({
    page,
    engine,
    locatorOrElement,
    behavior,
    verify,
    verifyFn,
    verificationTimeout,
    log,
  });

  if (!scrollResult.scrolled) {
    // Navigation/stop occurred during scroll
    return { scrolled: false, verified: false, skipped: false };
  }

  // Wait for scroll animation if specified
  if (waitAfterScroll > 0) {
    await wait({ ms: waitAfterScroll, reason: `${behavior} scroll animation to complete` });
  }

  if (scrollResult.verified) {
    log.debug(() => '✅ Scroll verification passed - element is in viewport');
  } else {
    log.debug(() => '⚠️  Scroll verification failed - element may not be fully in viewport');
  }

  return {
    scrolled: true,
    verified: scrollResult.verified,
    skipped: false,
  };
}
