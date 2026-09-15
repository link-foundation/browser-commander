/**
 * Readiness wiring for the navigation manager.
 *
 * Kept separate from `navigation-manager.js` so the two halves of "the page
 * stopped navigating" and "the page is actually usable" stay visibly distinct:
 * this module decides only the second question and reports the evidence behind
 * its answer.
 */

import {
  createDeadline,
  networkIdleFor,
  runReadinessChecks,
  urlStableFor,
} from './readiness.js';

/**
 * Build the checks that define "ready" when a caller does not supply their own.
 *
 * @param {Object} config - Navigation manager configuration
 * @param {number} config.redirectStabilizationTime - Required URL quiet period
 * @returns {Array} Ordered readiness checks
 */
export function defaultReadinessChecks(config) {
  return [
    urlStableFor({
      stableForMs: config.redirectStabilizationTime,
      intervalMs: 200,
    }),
    networkIdleFor(),
  ];
}

/**
 * Create the readiness waiter used by the navigation manager.
 *
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine name
 * @param {Function} options.log - Logger instance
 * @param {Object} [options.networkTracker] - NetworkTracker instance
 * @param {Object} options.config - Navigation manager configuration
 * @param {Function} options.getState - Returns `{currentUrl, sessionId}`
 * @param {Function} options.onUrlSample - Called with every sampled URL
 * @param {Function} options.onReady - Called when every check passed
 * @param {Function} options.onNotReady - Called when the wait did not succeed
 * @returns {{waitForReady: Function, getAdapter: Function}} Readiness API
 */
export function createReadinessWaiter(options = {}) {
  const {
    page,
    engine,
    log,
    networkTracker,
    config,
    getState,
    onUrlSample,
    onReady,
    onNotReady,
  } = options;

  let cachedAdapter;

  /**
   * Lazily build an engine adapter for checks that need to evaluate in-page.
   * Kept lazy so the default checks never touch a page that cannot evaluate.
   *
   * @returns {Promise<Object>} Engine adapter
   */
  async function getAdapter() {
    if (cachedAdapter === undefined) {
      const { createEngineAdapter } = await import('./engine-adapter.js');
      cachedAdapter = createEngineAdapter(page, engine);
    }
    return cachedAdapter;
  }

  /**
   * Wait for the page to be ready and report exactly what was observed.
   *
   * Every check shares one monotonic deadline, so the total wait can never
   * exceed `timeout` no matter how many checks run or how slow each one is.
   * The page-ready event fires only when every check actually passed.
   *
   * @param {Object} [opts] - Configuration options
   * @param {number} [opts.timeout] - Total budget in milliseconds
   * @param {string} [opts.reason] - Reason for waiting (for logging)
   * @param {Array} [opts.checks] - Composable readiness checks to run
   * @returns {Promise<Object>} Structured readiness result
   */
  async function waitForReady(opts = {}) {
    const {
      timeout = config.networkIdleTimeout,
      reason = 'page ready',
      checks,
    } = opts;

    log.debug(() => `⏳ Waiting for page ready (${reason})...`);

    const deadline = createDeadline({ timeout });
    const result = await runReadinessChecks({
      checks: checks ?? defaultReadinessChecks(config),
      deadline,
      context: {
        page,
        engine,
        log,
        networkTracker,
        getAdapter,
        onUrlSample,
      },
    });

    const outcome = { ...result, reason, ...getState() };

    if (outcome.ready) {
      onReady();
      log.debug(() => `✅ Page ready after ${outcome.elapsedMs}ms (${reason})`);
    } else {
      onNotReady();
      log.debug(
        () =>
          `⚠️  Page not ready (${reason}): ${outcome.status} after ` +
          `${outcome.elapsedMs}ms; failed=[${outcome.checks.failed.join(', ')}] ` +
          `pending=[${outcome.checks.pending.join(', ')}]`
      );
    }

    return outcome;
  }

  return { waitForReady, getAdapter };
}
