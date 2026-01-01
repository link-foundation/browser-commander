import { isNavigationError } from '../core/navigation-safety.js';
import { createEngineAdapter } from '../core/engine-adapter.js';

/**
 * Wait/sleep for a specified time with optional verbose logging
 * Now supports abort signals to interrupt the wait when navigation occurs
 *
 * @param {Object} options - Configuration options
 * @param {Function} options.log - Logger instance
 * @param {number} options.ms - Milliseconds to wait
 * @param {string} options.reason - Reason for waiting (for verbose logging)
 * @param {AbortSignal} options.abortSignal - Optional abort signal to interrupt wait
 * @returns {Promise<{completed: boolean, aborted: boolean}>}
 */
export async function wait(options = {}) {
  const { log, ms, reason, abortSignal } = options;

  if (!ms) {
    throw new Error('ms is required in options');
  }

  if (reason) {
    log.debug(() => `🔍 [VERBOSE] Waiting ${ms}ms: ${reason}`);
  }

  // If abort signal provided, use abortable wait
  if (abortSignal) {
    // Check if already aborted
    if (abortSignal.aborted) {
      log.debug(
        () => `🛑 Wait skipped (already aborted): ${reason || 'no reason'}`
      );
      return { completed: false, aborted: true };
    }

    return new Promise((resolve) => {
      let timeoutId = null;
      let abortHandler = null;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (abortHandler) {
          abortSignal.removeEventListener('abort', abortHandler);
        }
      };

      abortHandler = () => {
        cleanup();
        log.debug(() => `🛑 Wait aborted: ${reason || 'no reason'}`);
        resolve({ completed: false, aborted: true });
      };

      abortSignal.addEventListener('abort', abortHandler);

      timeoutId = setTimeout(() => {
        cleanup();
        if (reason) {
          log.debug(() => `🔍 [VERBOSE] Wait complete (${ms}ms)`);
        }
        resolve({ completed: true, aborted: false });
      }, ms);
    });
  }

  // Standard non-abortable wait (backwards compatible)
  await new Promise((r) => setTimeout(r, ms));

  if (reason) {
    log.debug(() => `🔍 [VERBOSE] Wait complete (${ms}ms)`);
  }

  return { completed: true, aborted: false };
}

/**
 * Evaluate JavaScript in page context
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {Function} options.fn - Function to evaluate
 * @param {Array} options.args - Arguments to pass to function (default: [])
 * @param {Object} options.adapter - Engine adapter (optional, will be created if not provided)
 * @returns {Promise<any>} - Result of evaluation
 */
export async function evaluate(options = {}) {
  const { page, engine, fn, args = [], adapter: providedAdapter } = options;

  if (!fn) {
    throw new Error('fn is required in options');
  }

  const adapter = providedAdapter || createEngineAdapter(page, engine);
  return await adapter.evaluateOnPage(fn, args);
}

/**
 * Safe evaluate that catches navigation errors and returns default value
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {Function} options.fn - Function to evaluate
 * @param {Array} options.args - Arguments to pass to function (default: [])
 * @param {any} options.defaultValue - Value to return on navigation error (default: null)
 * @param {string} options.operationName - Name for logging (default: 'evaluate')
 * @param {boolean} options.silent - Don't log warnings (default: false)
 * @returns {Promise<{success: boolean, value: any, navigationError: boolean}>}
 */
export async function safeEvaluate(options = {}) {
  const {
    page,
    engine,
    fn,
    args = [],
    defaultValue = null,
    operationName = 'evaluate',
    silent = false,
  } = options;

  try {
    const value = await evaluate({ page, engine, fn, args });
    return { success: true, value, navigationError: false };
  } catch (error) {
    if (isNavigationError(error)) {
      if (!silent) {
        console.log(
          `⚠️  Navigation detected during ${operationName}, recovering gracefully`
        );
      }
      return { success: false, value: defaultValue, navigationError: true };
    }
    throw error;
  }
}
