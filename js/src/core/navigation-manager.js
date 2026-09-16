/**
 * NavigationManager - Centralized navigation handling
 *
 * This module provides:
 * - Event-based navigation detection
 * - Redirect handling (JS and server-side)
 * - Wait for navigation to complete
 * - Page session management
 */

import { isNavigationError } from './navigation-safety.js';
import { TIMING } from './constants.js';
import { READINESS_STATUS } from './readiness.js';
import { createReadinessWaiter } from './navigation-readiness.js';

async function setManagedContent(options = {}) {
  const {
    page,
    log,
    html,
    waitUntil = 'load',
    timeout = 60000,
    currentUrl,
    triggerNavigationStart,
    updateCurrentUrl,
    waitForPageReady,
    abandonNavigation,
  } = options;

  if (typeof html !== 'string') {
    throw new Error('html is required in options');
  }

  log.debug(() => '🚀 Loading in-memory HTML content');

  try {
    // Treat document replacement as a controlled navigation so active page
    // triggers stop before the old document is discarded.
    await triggerNavigationStart({ url: currentUrl, isExternal: false });
    await page.setContent(html, { waitUntil, timeout });

    // setContent normally preserves the URL, but inline scripts can navigate.
    updateCurrentUrl();
    await waitForPageReady({ timeout, reason: 'after setContent' });
    return true;
  } catch (error) {
    // Do not leave the manager in its loading state when setContent fails, but
    // do not claim the page became ready either - it did not.
    abandonNavigation('setContent failed');
    if (isNavigationError(error)) {
      log.debug(() => '⚠️  Content loading was interrupted, recovering...');
      return false;
    }
    throw error;
  }
}

/**
 * Create a NavigationManager instance for a page
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Playwright or Puppeteer page object
 * @param {string} options.engine - 'playwright' or 'puppeteer'
 * @param {Function} options.log - Logger instance
 * @param {Object} options.networkTracker - NetworkTracker instance
 * @returns {Object} - NavigationManager API
 */
export function createNavigationManager(options = {}) {
  const { page, engine, log, networkTracker } = options;

  if (!page) {
    throw new Error('page is required in options');
  }

  // Current state
  let currentUrl = page.url();
  let isNavigating = false;
  let navigationStartTime = null;
  let navigationPromise = null;
  let navigationResolve = null;

  // Session tracking
  let sessionId = 0;
  let sessionCleanupCallbacks = [];

  // Abort controller for cancelling operations during navigation
  let currentAbortController = null;

  // Event listeners
  const listeners = {
    onNavigationStart: [],
    onNavigationComplete: [],
    onBeforeNavigate: [],
    onUrlChange: [],
    onPageReady: [],
  };

  // Configuration
  const config = {
    redirectStabilizationTime: 1000, // Time to wait for additional redirects
    maxRedirectWait: 60000, // Maximum time to wait for redirects
    networkIdleTimeout: 120000, // Maximum time to wait for network idle (2 minutes for slow connections)
  };

  /**
   * Handle frame navigation event
   */
  async function handleFrameNavigation(frame) {
    // Only handle main frame
    const mainFrame =
      engine === 'playwright' ? page.mainFrame() : page.mainFrame();
    if (frame !== mainFrame) {
      return;
    }

    const newUrl = frame.url();
    const previousUrl = currentUrl;

    if (newUrl === currentUrl) {
      return; // No actual URL change
    }

    log.debug(() => `🔗 URL change detected: ${previousUrl} → ${newUrl}`);

    // Notify URL change listeners
    listeners.onUrlChange.forEach((fn) => {
      try {
        fn({ previousUrl, newUrl, sessionId });
      } catch (e) {
        log.debug(() => `⚠️  Error in onUrlChange listener: ${e.message}`);
      }
    });

    currentUrl = newUrl;

    // If we're not in a controlled navigation, this is an external navigation
    if (!isNavigating) {
      log.debug(
        () => '🔄 External navigation detected (JS redirect or link click)'
      );

      // Trigger navigation start
      await triggerNavigationStart({ url: newUrl, isExternal: true });
    }
  }

  /**
   * Trigger navigation start event
   */
  async function triggerNavigationStart(details = {}) {
    const { url, isExternal = false } = details;

    // IMPORTANT: Abort any ongoing operations immediately
    // This signals to all running automation that navigation is happening
    if (currentAbortController) {
      log.debug(() => '🛑 Aborting previous operations due to navigation');
      currentAbortController.abort();
    }
    // Create new abort controller for this navigation session
    currentAbortController = new AbortController();

    // Call beforeNavigate handlers for cleanup
    log.debug(() => '📤 Triggering onBeforeNavigate callbacks...');
    for (const fn of listeners.onBeforeNavigate) {
      try {
        await fn({ currentUrl, sessionId });
      } catch (e) {
        log.debug(() => `⚠️  Error in onBeforeNavigate listener: ${e.message}`);
      }
    }

    // Run session cleanup callbacks
    log.debug(
      () =>
        `🧹 Running ${sessionCleanupCallbacks.length} session cleanup callbacks...`
    );
    for (const fn of sessionCleanupCallbacks) {
      try {
        await fn();
      } catch (e) {
        log.debug(() => `⚠️  Error in session cleanup: ${e.message}`);
      }
    }
    sessionCleanupCallbacks = [];

    // Start new session
    sessionId++;
    isNavigating = true;
    navigationStartTime = Date.now();

    // Reset network tracker for new navigation
    if (networkTracker) {
      networkTracker.reset();
    }

    // Notify navigation start listeners
    listeners.onNavigationStart.forEach((fn) => {
      try {
        fn({
          url: url || currentUrl,
          sessionId,
          isExternal,
          abortSignal: currentAbortController.signal,
        });
      } catch (e) {
        log.debug(
          () => `⚠️  Error in onNavigationStart listener: ${e.message}`
        );
      }
    });

    // If external navigation, wait for it to complete
    if (isExternal) {
      await waitForPageReady({ reason: 'external navigation' });
    }
  }

  // Track if a readiness wait is currently running to prevent concurrent calls
  let pageReadyPromise = null;

  const { waitForReady } = createReadinessWaiter({
    page,
    engine,
    log,
    networkTracker,
    config,
    getState: () => ({ url: currentUrl, sessionId }),
    onUrlSample: (url) => {
      if (url !== currentUrl) {
        currentUrl = url;
        log.debug(() => `🔄 Redirect detected: ${url}`);
      }
    },
    onReady: () => {
      finishNavigationTracking({ ready: true });
      emitPageReady();
    },
    onNotReady: () => finishNavigationTracking({ ready: false }),
  });

  /**
   * Boolean-returning readiness wait kept for backward compatibility.
   *
   * Unlike the previous implementation this returns `false` when the page did
   * not actually become ready, and it never emits the page-ready event in that
   * case. Prefer {@link waitForReady} for the structured result.
   *
   * @param {Object} [opts] - Same options as {@link waitForReady}
   * @returns {Promise<boolean>} Whether the page genuinely became ready
   */
  async function waitForPageReady(opts = {}) {
    const { reason = 'page ready' } = opts;

    // Concurrent callers join the in-flight wait instead of racing a second
    // deadline against the first.
    if (pageReadyPromise) {
      log.debug(
        () => `⏳ Waiting for existing page ready operation (${reason})...`
      );
      return pageReadyPromise;
    }

    pageReadyPromise = waitForReady(opts).then((result) => result.ready);

    try {
      return await pageReadyPromise;
    } finally {
      pageReadyPromise = null;
    }
  }

  /**
   * Leave the navigating state without claiming the page became ready.
   *
   * @param {string} reason - Why the navigation was abandoned
   */
  function abandonNavigation(reason) {
    log.debug(() => `⚠️  Navigation abandoned: ${reason}`);
    finishNavigationTracking({ ready: false });
  }

  /**
   * Close out navigation bookkeeping.
   *
   * This only reports that the navigation stopped being in flight. Whether the
   * page is usable is a separate question answered by {@link emitPageReady},
   * which is why the two are no longer one function.
   *
   * @param {Object} [options] - Configuration options
   * @param {boolean} [options.ready=false] - Whether the page reached a ready state
   */
  function finishNavigationTracking(options = {}) {
    const { ready = false } = options;

    if (!isNavigating) {
      return;
    }

    isNavigating = false;
    const duration = Date.now() - navigationStartTime;
    navigationStartTime = null;

    log.debug(
      () =>
        `${ready ? '✅' : '⚠️ '} Navigation finished (session ${sessionId}, ` +
        `${duration}ms, ready=${ready})`
    );

    listeners.onNavigationComplete.forEach((fn) => {
      try {
        fn({ url: currentUrl, sessionId, duration, ready });
      } catch (e) {
        log.debug(
          () => `⚠️  Error in onNavigationComplete listener: ${e.message}`
        );
      }
    });

    if (navigationResolve) {
      navigationResolve(ready);
      navigationResolve = null;
      navigationPromise = null;
    }
  }

  /**
   * Announce that the page reached a ready state.
   */
  function emitPageReady() {
    listeners.onPageReady.forEach((fn) => {
      try {
        fn({ url: currentUrl, sessionId });
      } catch (e) {
        log.debug(() => `⚠️  Error in onPageReady listener: ${e.message}`);
      }
    });
  }

  /**
   * Navigate to URL with full wait
   * @param {Object} options - Configuration options
   * @param {string} options.url - URL to navigate to
   * @param {string} options.waitUntil - Playwright/Puppeteer waitUntil option
   * @param {number} options.timeout - Navigation timeout
   * @returns {Promise<boolean>} - True if navigation succeeded
   */
  async function navigate(opts = {}) {
    const { url, waitUntil = 'domcontentloaded', timeout = 60000 } = opts;

    if (!url) {
      throw new Error('url is required in options');
    }

    log.debug(() => `🚀 Navigating to: ${url}`);

    try {
      // Trigger navigation start
      await triggerNavigationStart({ url, isExternal: false });

      // Perform navigation
      await page.goto(url, { waitUntil, timeout });

      // Update current URL
      currentUrl = page.url();

      // Wait for page to be fully ready
      return await waitForPageReady({ timeout, reason: 'after goto' });
    } catch (error) {
      if (isNavigationError(error)) {
        log.debug(() => '⚠️  Navigation was interrupted, recovering...');
        abandonNavigation('navigation interrupted');
        return false;
      }
      throw error;
    }
  }

  const setContent = (opts = {}) =>
    setManagedContent({
      page,
      log,
      ...opts,
      currentUrl,
      triggerNavigationStart,
      updateCurrentUrl: () => (currentUrl = page.url()),
      waitForPageReady,
      abandonNavigation,
    });

  /**
   * Wait for any pending navigation to complete
   * @param {Object} options - Configuration options
   * @param {number} options.timeout - Maximum time to wait
   * @returns {Promise<boolean>} - True if navigation completed
   */
  async function waitForNavigation(opts = {}) {
    const { timeout = TIMING.NAVIGATION_TIMEOUT } = opts;

    if (!isNavigating) {
      return true; // Already ready
    }

    // Create a promise that resolves when navigation completes
    if (!navigationPromise) {
      navigationPromise = new Promise((resolve) => {
        navigationResolve = resolve;

        // Timeout handler
        setTimeout(() => {
          if (isNavigating) {
            log.debug(() => '⚠️  waitForNavigation timeout');
            abandonNavigation('waitForNavigation timeout');
            resolve(false);
          }
        }, timeout);
      });
    }

    return await navigationPromise;
  }

  /**
   * Get the current abort signal
   * Use this to check if operations should be aborted due to navigation
   * @returns {AbortSignal|null}
   */
  function getAbortSignal() {
    return currentAbortController ? currentAbortController.signal : null;
  }

  /**
   * Check if current operation should be aborted (navigation in progress)
   * Returns true if:
   * 1. The current abort controller's signal is aborted, OR
   * 2. Navigation is currently in progress (isNavigating is true)
   * @returns {boolean}
   */
  function shouldAbort() {
    // If we're currently navigating, operations should abort
    if (isNavigating) {
      return true;
    }
    // Also check the abort signal for backwards compatibility
    return currentAbortController
      ? currentAbortController.signal.aborted
      : false;
  }

  /**
   * Register cleanup callback for current session
   * Will be called before next navigation
   */
  function onSessionCleanup(callback) {
    sessionCleanupCallbacks.push(callback);
  }

  /**
   * Add event listener
   */
  function on(event, callback) {
    if (listeners[event]) {
      listeners[event].push(callback);
    }
  }

  /**
   * Remove event listener
   */
  function off(event, callback) {
    if (listeners[event]) {
      const index = listeners[event].indexOf(callback);
      if (index !== -1) {
        listeners[event].splice(index, 1);
      }
    }
  }

  /**
   * Start listening for navigation events
   */
  function startListening() {
    page.on('framenavigated', handleFrameNavigation);
    log.debug(() => '🔌 Navigation manager started');
  }

  /**
   * Stop listening for navigation events
   */
  function stopListening() {
    page.off('framenavigated', handleFrameNavigation);
    log.debug(() => '🔌 Navigation manager stopped');
  }

  /**
   * Update configuration
   */
  function configure(newConfig) {
    Object.assign(config, newConfig);
  }

  return {
    // Navigation
    navigate,
    setContent,
    waitForNavigation,
    waitForPageReady,
    waitForReady,

    // State
    isNavigating: () => isNavigating,
    getCurrentUrl: () => currentUrl,
    getSessionId: () => sessionId,

    // Abort handling - use these to stop operations when navigation occurs
    getAbortSignal,
    shouldAbort,

    // Session management
    onSessionCleanup,

    // Event listeners
    on,
    off,

    // Lifecycle
    startListening,
    stopListening,
    configure,

    // Readiness status vocabulary, re-exported for callers matching on it
    READINESS_STATUS,
  };
}
