/**
 * Navigation-related browser operations
 *
 * This module provides navigation functions that can work with or without
 * the NavigationManager for backwards compatibility.
 */

import { navigationPhase } from '../core/navigation-operation.js';
import { TIMING } from '../core/constants.js';
import { isNavigationError } from '../core/navigation-safety.js';
import { isActionStoppedError } from '../core/page-trigger-manager.js';
import {
  READINESS_STATUS,
  createDeadline,
  networkIdleFor,
  runReadinessChecks,
  runWithinDeadline,
  sleepWithinDeadline,
  urlStableFor,
} from '../core/readiness.js';

/**
 * Default verification function for navigation operations.
 * Verifies that navigation completed by checking:
 * - URL matches expected pattern (if provided)
 * - Page is in a ready state
 *
 * @param {Object} options - Verification options
 * @param {Object} options.page - Browser page object
 * @param {string} options.expectedUrl - Expected URL or URL pattern (optional)
 * @param {string} options.startUrl - URL before navigation
 * @returns {Promise<{verified: boolean, actualUrl: string, reason: string}>}
 */
export async function defaultNavigationVerification(options = {}) {
  const { page, expectedUrl, startUrl } = options;

  try {
    const actualUrl = await Promise.resolve(page.url());

    // If expected URL is provided, verify it matches
    if (expectedUrl) {
      // Check for exact match or pattern match
      if (actualUrl === expectedUrl) {
        return { verified: true, actualUrl, reason: 'exact URL match' };
      }
      // Check if expected URL is contained in actual URL (for patterns)
      if (
        actualUrl.includes(expectedUrl) ||
        actualUrl.startsWith(expectedUrl)
      ) {
        return { verified: true, actualUrl, reason: 'URL pattern match' };
      }
      // Check if it's a regex pattern
      if (expectedUrl instanceof RegExp && expectedUrl.test(actualUrl)) {
        return { verified: true, actualUrl, reason: 'URL regex match' };
      }

      return {
        verified: false,
        actualUrl,
        reason: `URL mismatch: expected "${expectedUrl}", got "${actualUrl}"`,
      };
    }

    // No expected URL - just verify URL changed from start
    if (startUrl && actualUrl !== startUrl) {
      return { verified: true, actualUrl, reason: 'URL changed from start' };
    }

    // If no start URL and no expected URL, assume success
    return { verified: true, actualUrl, reason: 'navigation completed' };
  } catch (error) {
    if (isNavigationError(error) || isActionStoppedError(error)) {
      return {
        verified: false,
        actualUrl: '',
        reason: 'error during verification',
        navigationError: true,
      };
    }
    throw error;
  }
}

/**
 * Verify navigation operation with retry logic
 * @param {Object} options - Verification options
 * @param {Object} options.page - Browser page object
 * @param {string} options.expectedUrl - Expected URL (optional)
 * @param {string} options.startUrl - URL before navigation
 * @param {Function} options.verifyFn - Custom verification function (optional)
 * @param {number} options.timeout - Verification timeout in ms (default: TIMING.VERIFICATION_TIMEOUT)
 * @param {number} options.retryInterval - Interval between retries (default: TIMING.VERIFICATION_RETRY_INTERVAL)
 * @param {Function} options.log - Logger instance
 * @returns {Promise<{verified: boolean, actualUrl: string, reason: string, attempts: number}>}
 */
export async function verifyNavigation(options = {}) {
  const {
    page,
    expectedUrl,
    startUrl,
    verifyFn = defaultNavigationVerification,
    timeout = TIMING.VERIFICATION_TIMEOUT,
    retryInterval = TIMING.VERIFICATION_RETRY_INTERVAL,
    log = { debug: () => {} },
  } = options;

  const deadline =
    options.deadline ?? createDeadline({ timeout, signal: options.signal });
  const verificationEnd = performance.now() + timeout;
  const budget = {
    ...deadline,
    remainingMs: () =>
      Math.max(
        0,
        Math.min(deadline.remainingMs(), verificationEnd - performance.now())
      ),
    expired: () => deadline.expired() || performance.now() >= verificationEnd,
  };
  let attempts = 0;
  let lastResult = { verified: false, actualUrl: '', reason: '' };

  while (!budget.expired() && !budget.signal?.aborted) {
    attempts++;
    const probe = await runWithinDeadline(budget, () =>
      verifyFn({ page, expectedUrl, startUrl })
    );
    if (probe.timedOut || probe.interrupted) {
      break;
    }
    lastResult = probe.value;

    if (lastResult.verified) {
      log.debug(
        () =>
          `✅ Navigation verification succeeded after ${attempts} attempt(s): ${lastResult.reason}`
      );
      return { ...lastResult, attempts };
    }

    if (lastResult.navigationError) {
      log.debug(() => '⚠️  Navigation/stop detected during verification');
      return { ...lastResult, attempts };
    }

    // Wait before next retry
    await sleepWithinDeadline(retryInterval, budget);
  }

  log.debug(
    () =>
      `❌ Navigation verification failed after ${attempts} attempts: ${lastResult.reason}`
  );
  return { ...lastResult, attempts };
}

/**
 * Wait for URL to stabilize (no redirects happening)
 * This is a legacy polling-based approach for backwards compatibility.
 * When navigationManager is available, use waitForPageReady instead.
 *
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {Function} options.log - Logger instance
 * @param {Function} options.wait - Wait function
 * @param {Object} options.navigationManager - NavigationManager instance (optional)
 * @param {number} options.stableChecks - Number of consecutive stable checks required (default: 3)
 * @param {number} options.checkInterval - Interval between stability checks in ms (default: 1000)
 * @param {number} options.timeout - Maximum time to wait for stabilization in ms (default: 30000)
 * @param {string} options.reason - Reason for stabilization (for logging)
 * @returns {Promise<boolean>} - True if stabilized, false if timeout
 */
export async function waitForUrlStabilization(options = {}) {
  const {
    page,
    log,
    wait: _wait,
    navigationManager,
    stableChecks = 3,
    checkInterval = 1000,
    timeout = 30000,
    reason = 'URL stabilization',
  } = options;

  // If NavigationManager is available, delegate to it
  if (navigationManager) {
    return navigationManager.waitForPageReady({ ...options, timeout, reason });
  }

  // Legacy polling-based approach
  log.debug(() => `⏳ Waiting for URL to stabilize (${reason})...`);
  let stableCount = 0;
  let lastUrl = page.url();
  const deadline =
    options.deadline ?? createDeadline({ timeout, signal: options.signal });

  while (stableCount < stableChecks) {
    // Check timeout
    if (deadline.expired() || deadline.signal?.aborted) {
      log.debug(
        () => `⚠️  URL stabilization timeout after ${timeout}ms (${reason})`
      );
      return false;
    }

    await sleepWithinDeadline(checkInterval, deadline);
    if (deadline.expired() || deadline.signal?.aborted) {
      return false;
    }
    const currentUrl = page.url();

    if (currentUrl === lastUrl) {
      stableCount++;
      log.debug(
        () =>
          `🔍 [VERBOSE] URL stable for ${stableCount}/${stableChecks} checks: ${currentUrl}`
      );
    } else {
      stableCount = 0;
      lastUrl = currentUrl;
      log.debug(
        () =>
          `🔍 [VERBOSE] URL changed to: ${currentUrl}, resetting stability counter`
      );
    }
  }

  log.debug(() => `✅ URL stabilized (${reason})`);
  return true;
}

async function legacyGotoReadiness(options, deadline) {
  const {
    page,
    url,
    waitForUrlStabilization: stabilizeFn,
    waitUntil,
    waitForStableUrlBefore,
    waitForStableUrlAfter,
    waitForNetworkIdle,
    stableChecks,
    checkInterval,
    checks,
  } = options;
  if (waitForStableUrlBefore && stabilizeFn) {
    await navigationPhase(deadline, () =>
      stabilizeFn({
        stableChecks,
        checkInterval,
        timeout: deadline.remainingMs(),
        deadline,
        reason: 'before navigation',
      })
    );
  }
  await navigationPhase(deadline, () =>
    page.goto(url, {
      waitUntil,
      timeout: Math.max(1, deadline.remainingMs()),
    })
  );
  const readiness = checks ?? [
    ...(waitForStableUrlAfter
      ? [
          urlStableFor({
            intervalMs: checkInterval,
            stableForMs: checkInterval,
            consecutiveSamples: stableChecks,
          }),
        ]
      : []),
    ...(waitForNetworkIdle ? [networkIdleFor()] : []),
  ];
  return runReadinessChecks({
    checks: readiness,
    deadline,
    context: { page, networkTracker: options.networkTracker },
  });
}

function navigationFailureStatus(error, signal) {
  if (signal?.aborted) {
    return 'interrupted';
  }
  if (error.status) {
    return error.status;
  }
  if (error.name === 'TimeoutError') {
    return 'timed_out';
  }
  return isNavigationError(error) || isActionStoppedError(error)
    ? 'interrupted'
    : null;
}

/**
 * Navigate to URL with full wait for page ready
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {Function} options.waitForUrlStabilization - URL stabilization function (legacy)
 * @param {Object} options.navigationManager - NavigationManager instance (preferred)
 * @param {Function} options.log - Logger instance (optional)
 * @param {string} options.url - URL to navigate to
 * @param {string} options.waitUntil - Wait until condition (default: 'domcontentloaded')
 * @param {boolean} options.waitForStableUrlBefore - Wait for URL to stabilize BEFORE navigation (default: true)
 * @param {boolean} options.waitForStableUrlAfter - Wait for URL to stabilize AFTER navigation (default: true)
 * @param {boolean} options.waitForNetworkIdle - Wait for all network requests to complete (default: true)
 * @param {number} options.stableChecks - Number of consecutive stable checks required (default: 3)
 * @param {number} options.checkInterval - Interval between stability checks in ms (default: 1000)
 * @param {number} options.timeout - Navigation timeout in ms (default: 240000)
 * @param {boolean} options.verify - Whether to verify the navigation (default: true)
 * @param {Function} options.verifyFn - Custom verification function (optional)
 * @param {number} options.verificationTimeout - Verification timeout in ms (default: TIMING.VERIFICATION_TIMEOUT)
 * @returns {Promise<Object>} Navigation result.
 */
export async function goto(options = {}) {
  const {
    page,
    navigationManager,
    log = { debug: () => {} },
    url,
    waitUntil = 'domcontentloaded',
    waitForStableUrlBefore = true,
    waitForStableUrlAfter = true,
    waitForNetworkIdle = true,
    stableChecks = 3,
    checkInterval = 1000,
    timeout = 240000,
    verify = true,
    verifyFn,
    verificationTimeout = TIMING.VERIFICATION_TIMEOUT,
  } = options;

  if (!url) {
    throw new Error('url is required in options');
  }

  const { signal, checks } = options;
  const deadline = options.deadline ?? createDeadline({ timeout, signal });
  const startUrl = page.url();
  try {
    let outcome;
    if (navigationManager) {
      const result = await navigationPhase(deadline, () =>
        navigationManager.navigate({
          url,
          waitUntil,
          timeout,
          deadline,
          signal,
          checks,
          waitForStableUrlBefore,
          waitForStableUrlAfter,
          waitForNetworkIdle,
          stableChecks,
          checkInterval,
          returnOutcome: true,
        })
      );
      outcome =
        typeof result === 'boolean'
          ? { ready: result, status: result ? 'ready' : 'failed' }
          : result;
    } else {
      outcome = await legacyGotoReadiness(
        {
          ...options,
          waitUntil,
          waitForStableUrlBefore,
          waitForStableUrlAfter,
          waitForNetworkIdle,
          stableChecks,
          checkInterval,
        },
        deadline
      );
    }
    if (!outcome.ready) {
      return {
        navigated: false,
        verified: false,
        actualUrl: page.url(),
        status: outcome.status,
        readiness: outcome,
      };
    }
    if (verify) {
      const verified = await navigationPhase(deadline, () =>
        verifyNavigation({
          page,
          expectedUrl: url,
          startUrl,
          verifyFn,
          timeout: Math.min(verificationTimeout, deadline.remainingMs()),
          log,
          deadline: {
            ...deadline,
            remainingMs: () =>
              Math.min(verificationTimeout, deadline.remainingMs()),
          },
        })
      );
      return {
        navigated: true,
        ...verified,
        status: verified.verified ? 'ready' : 'failed',
        readiness: outcome,
      };
    }
    return {
      navigated: true,
      verified: true,
      actualUrl: page.url(),
      status: 'ready',
      readiness: outcome,
    };
  } catch (error) {
    const status = navigationFailureStatus(error, signal);
    if (status) {
      navigationManager?.cancelNavigation?.();
      return {
        navigated: false,
        verified: false,
        actualUrl: page.url(),
        status,
        reason: error.message,
      };
    }
    throw error;
  }
}

/**
 * Replace the current document with an in-memory HTML string.
 * When NavigationManager is available, this uses the same managed lifecycle as
 * goto so active page triggers are stopped before the document is replaced.
 *
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {Object} options.navigationManager - NavigationManager instance (preferred)
 * @param {string} options.html - HTML to load
 * @param {string} options.waitUntil - Wait until condition (default: 'load')
 * @param {number} options.timeout - Content loading timeout in ms (default: 60000)
 * @returns {Promise<Object>} Content loading result
 */
export async function setContent(options = {}) {
  const {
    page,
    navigationManager,
    html,
    waitUntil = 'load',
    timeout = 60000,
  } = options;

  if (typeof html !== 'string') {
    throw new Error('html is required in options');
  }

  try {
    let loaded;
    if (navigationManager) {
      loaded = await navigationManager.setContent({
        html,
        waitUntil,
        timeout,
      });
    } else {
      await page.setContent(html, { waitUntil, timeout });
      loaded = true;
    }

    return loaded
      ? { loaded: true, actualUrl: page.url() }
      : {
          loaded: false,
          actualUrl: page.url(),
          reason: 'content loading stopped/interrupted',
        };
  } catch (error) {
    if (isNavigationError(error) || isActionStoppedError(error)) {
      return {
        loaded: false,
        actualUrl: page.url(),
        reason: 'content loading stopped/interrupted',
      };
    }
    throw error;
  }
}

/**
 * Wait for navigation
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {Object} options.navigationManager - NavigationManager instance (optional)
 * @param {number} options.timeout - Timeout in ms
 * @returns {Promise<boolean>} - True if navigation completed, false on error
 */
export async function waitForNavigation(options = {}) {
  const { page, navigationManager, timeout } = options;

  // If NavigationManager is available, use it
  if (navigationManager) {
    return navigationManager.waitForNavigation({ timeout });
  }

  // Legacy approach
  try {
    await page.waitForNavigation(timeout ? { timeout } : undefined);
    return true;
  } catch (error) {
    if (isNavigationError(error)) {
      console.log(
        '⚠️  waitForNavigation was interrupted, continuing gracefully'
      );
      return false;
    }
    throw error;
  }
}

/**
 * Wait for page to be fully ready (DOM loaded + network idle + no redirects)
 * This is the recommended method for ensuring page is ready for manipulation.
 *
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {Object} options.navigationManager - NavigationManager instance (required for full functionality)
 * @param {Object} options.networkTracker - NetworkTracker instance (optional)
 * @param {Function} options.log - Logger instance
 * @param {Function} options.wait - Wait function
 * @param {number} options.timeout - Maximum time to wait (default: 30000ms)
 * @param {string} options.reason - Reason for waiting (for logging)
 * @returns {Promise<boolean>} - True if ready, false if timeout
 */
export async function waitForPageReady(options = {}) {
  const {
    navigationManager,
    networkTracker,
    log,
    wait,
    timeout = 30000,
    reason = 'page ready',
  } = options;

  // If NavigationManager is available, delegate to it
  if (navigationManager) {
    return navigationManager.waitForPageReady({ timeout, reason });
  }

  // Fallback: use network tracker directly if available
  if (networkTracker) {
    log.debug(() => `⏳ Waiting for page ready (${reason})...`);
    const startTime = Date.now();

    // Wait for network idle
    const networkIdle = await networkTracker.waitForNetworkIdle({
      timeout,
    });

    const elapsed = Date.now() - startTime;
    if (networkIdle) {
      log.debug(() => `✅ Page ready after ${elapsed}ms (${reason})`);
    } else {
      log.debug(() => `⚠️  Page ready timeout after ${elapsed}ms (${reason})`);
    }

    return networkIdle;
  }

  // Minimal fallback: just wait a bit for DOM to settle
  log.debug(() => `⏳ Waiting for page ready - minimal mode (${reason})...`);
  await wait({ ms: 1000, reason: 'page settle time' });
  return true;
}

/**
 * Wait for the page to be ready and return structured evidence.
 *
 * Unlike {@link waitForPageReady}, which answers with a single boolean, this
 * reports which checks passed, which failed, which were skipped and which never
 * got to run before the shared deadline expired.
 *
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} [options.engine] - Engine type
 * @param {Object} [options.navigationManager] - NavigationManager instance
 * @param {Object} [options.networkTracker] - NetworkTracker instance
 * @param {Function} [options.log] - Logger instance
 * @param {number} [options.timeout=30000] - Total budget in milliseconds
 * @param {string} [options.reason='page ready'] - Reason for waiting
 * @param {Array} [options.checks] - Composable readiness checks
 * @returns {Promise<Object>} Structured readiness result
 */
export async function waitForReady(options = {}) {
  const {
    page,
    engine,
    navigationManager,
    networkTracker,
    log = { debug: () => {} },
    timeout = 30000,
    reason = 'page ready',
    checks,
  } = options;

  if (navigationManager?.waitForReady) {
    return navigationManager.waitForReady({ timeout, reason, checks });
  }

  const deadline = createDeadline({ timeout });
  const result = await runReadinessChecks({
    checks: checks ?? [urlStableFor(), networkIdleFor()],
    deadline,
    context: {
      page,
      engine,
      log,
      networkTracker,
      getAdapter: async () => {
        const { createEngineAdapter } =
          await import('../core/engine-adapter.js');
        return createEngineAdapter(page, engine);
      },
    },
  });

  return { ...result, reason, url: page?.url?.() ?? null };
}

export { READINESS_STATUS };

/**
 * Wait for any ongoing navigation and network requests to complete.
 * Use this after actions that might trigger navigation (like clicks).
 *
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {Object} options.navigationManager - NavigationManager instance
 * @param {Object} options.networkTracker - NetworkTracker instance
 * @param {Function} options.log - Logger instance
 * @param {Function} options.wait - Wait function
 * @param {number} options.navigationCheckDelay - Time to wait for potential navigation to start (default: 500ms)
 * @param {number} options.timeout - Maximum time to wait (default: 30000ms)
 * @param {string} options.reason - Reason for waiting (for logging)
 * @returns {Promise<{navigated: boolean, ready: boolean}>}
 */
export async function waitAfterAction(options = {}) {
  const {
    page,
    navigationManager,
    networkTracker,
    log,
    wait,
    navigationCheckDelay = 500,
    timeout = 30000,
    reason = 'after action',
  } = options;

  const startUrl = page.url();
  const startTime = Date.now();

  log.debug(() => `⏳ Waiting after action (${reason})...`);

  // Wait briefly for potential navigation to start
  await wait({ ms: navigationCheckDelay, reason: 'checking for navigation' });

  // Check if navigation is in progress or URL changed
  const currentUrl = page.url();
  const urlChanged = currentUrl !== startUrl;

  if (navigationManager && navigationManager.isNavigating()) {
    log.debug(() => '🔄 Navigation in progress, waiting for completion...');
    await navigationManager.waitForNavigation({
      timeout: timeout - (Date.now() - startTime),
    });
    return { navigated: true, ready: true };
  }

  if (urlChanged) {
    log.debug(() => `🔄 URL changed: ${startUrl} → ${currentUrl}`);

    // Wait for page to be fully ready
    await waitForPageReady({
      page,
      navigationManager,
      networkTracker,
      log,
      wait,
      timeout: timeout - (Date.now() - startTime),
      reason: 'after URL change',
    });

    return { navigated: true, ready: true };
  }

  // No navigation detected, just wait for network idle
  // Use shorter idle time since this is just for XHR completion, not full page load
  if (networkTracker) {
    const idle = await networkTracker.waitForNetworkIdle({
      timeout: Math.max(0, timeout - (Date.now() - startTime)),
      idleTime: 2000, // Shorter idle time for non-navigation actions
    });
    return { navigated: false, ready: idle };
  }

  return { navigated: false, ready: true };
}
