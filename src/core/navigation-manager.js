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
  const {
    page,
    engine,
    log,
    networkTracker,
  } = options;

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
    const mainFrame = engine === 'playwright' ? page.mainFrame() : page.mainFrame();
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
    listeners.onUrlChange.forEach(fn => {
      try {
        fn({ previousUrl, newUrl, sessionId });
      } catch (e) {
        log.debug(() => `⚠️  Error in onUrlChange listener: ${e.message}`);
      }
    });

    currentUrl = newUrl;

    // If we're not in a controlled navigation, this is an external navigation
    if (!isNavigating) {
      log.debug(() => '🔄 External navigation detected (JS redirect or link click)');

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
    log.debug(() => `🧹 Running ${sessionCleanupCallbacks.length} session cleanup callbacks...`);
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
    listeners.onNavigationStart.forEach(fn => {
      try {
        fn({ url: url || currentUrl, sessionId, isExternal, abortSignal: currentAbortController.signal });
      } catch (e) {
        log.debug(() => `⚠️  Error in onNavigationStart listener: ${e.message}`);
      }
    });

    // If external navigation, wait for it to complete
    if (isExternal) {
      await waitForPageReady({ reason: 'external navigation' });
    }
  }

  // Track if waitForPageReady is currently running to prevent concurrent calls
  let pageReadyPromise = null;

  /**
   * Wait for page to be ready (DOM loaded + network idle + no redirects)
   * @param {Object} options - Configuration options
   * @param {number} options.timeout - Maximum time to wait
   * @param {string} options.reason - Reason for waiting (for logging)
   * @returns {Promise<boolean>} - True if ready, false if timeout
   */
  async function waitForPageReady(opts = {}) {
    const {
      timeout = config.networkIdleTimeout,
      reason = 'page ready',
    } = opts;

    // If another waitForPageReady is already running, wait for it instead of starting a new one
    // This prevents concurrent waits that can cause race conditions
    if (pageReadyPromise) {
      log.debug(() => `⏳ Waiting for existing page ready operation (${reason})...`);
      return pageReadyPromise;
    }

    log.debug(() => `⏳ Waiting for page ready (${reason})...`);

    // Create the promise and store it
    pageReadyPromise = (async () => {
      const startTime = Date.now();
      let lastUrlChangeTime = Date.now();

      // Wait for URL to stabilize (no more redirects)
      while (Date.now() - lastUrlChangeTime < config.redirectStabilizationTime) {
        if (Date.now() - startTime > timeout) {
          log.debug(() => `⚠️  Page ready timeout after ${timeout}ms (${reason})`);
          break;
        }

        await new Promise(r => setTimeout(r, 200));

        // Check if URL changed
        const nowUrl = page.url();
        if (nowUrl !== currentUrl) {
          currentUrl = nowUrl;
          lastUrlChangeTime = Date.now();
          log.debug(() => `🔄 Redirect detected: ${nowUrl}`);
        }
      }

      // Wait for network idle - use remaining time but ensure at least 30s for idle check
      // The 30s idle time is enforced by the network tracker's idleTimeout config
      if (networkTracker) {
        const elapsed = Date.now() - startTime;
        // Give at least 60 seconds for network idle, or remaining time if more
        const remainingTimeout = Math.max(60000, timeout - elapsed);

        const networkIdle = await networkTracker.waitForNetworkIdle({
          timeout: remainingTimeout,
          // idleTime defaults to 30000ms from tracker config
        });

        if (!networkIdle) {
          log.debug(() => `⚠️  Network did not become idle (${reason})`);
        }
      }

      // Complete navigation
      completeNavigation();

      const elapsed = Date.now() - startTime;
      log.debug(() => `✅ Page ready after ${elapsed}ms (${reason})`);

      return true;
    })();

    try {
      return await pageReadyPromise;
    } finally {
      // Clear the promise so next call can start fresh
      pageReadyPromise = null;
    }
  }

  /**
   * Complete current navigation
   */
  function completeNavigation() {
    if (!isNavigating) {
      return;
    }

    isNavigating = false;
    const duration = Date.now() - navigationStartTime;
    navigationStartTime = null;

    log.debug(() => `✅ Navigation complete (session ${sessionId}, ${duration}ms)`);

    // Notify navigation complete listeners
    listeners.onNavigationComplete.forEach(fn => {
      try {
        fn({ url: currentUrl, sessionId, duration });
      } catch (e) {
        log.debug(() => `⚠️  Error in onNavigationComplete listener: ${e.message}`);
      }
    });

    // Notify page ready listeners
    listeners.onPageReady.forEach(fn => {
      try {
        fn({ url: currentUrl, sessionId });
      } catch (e) {
        log.debug(() => `⚠️  Error in onPageReady listener: ${e.message}`);
      }
    });

    // Resolve navigation promise if waiting
    if (navigationResolve) {
      navigationResolve(true);
      navigationResolve = null;
      navigationPromise = null;
    }
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
    const {
      url,
      waitUntil = 'domcontentloaded',
      timeout = 60000,
    } = opts;

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
      await waitForPageReady({ timeout, reason: 'after goto' });

      return true;
    } catch (error) {
      if (isNavigationError(error)) {
        log.debug(() => '⚠️  Navigation was interrupted, recovering...');
        completeNavigation();
        return false;
      }
      throw error;
    }
  }

  /**
   * Wait for any pending navigation to complete
   * @param {Object} options - Configuration options
   * @param {number} options.timeout - Maximum time to wait
   * @returns {Promise<boolean>} - True if navigation completed
   */
  async function waitForNavigation(opts = {}) {
    const { timeout = 30000 } = opts;

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
            completeNavigation();
            resolve(false);
          }
        }, timeout);
      });
    }

    return navigationPromise;
  }

  /**
   * Check if we're currently navigating
   */
  function isCurrentlyNavigating() {
    return isNavigating;
  }

  /**
   * Get current URL
   */
  function getCurrentUrl() {
    return currentUrl;
  }

  /**
   * Get current session ID
   */
  function getSessionId() {
    return sessionId;
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
    return currentAbortController ? currentAbortController.signal.aborted : false;
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
    waitForNavigation,
    waitForPageReady,

    // State
    isNavigating: isCurrentlyNavigating,
    getCurrentUrl,
    getSessionId,

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
  };
}
