/**
 * NetworkTracker - Track all HTTP requests and wait for network idle
 *
 * This module monitors all network requests on a page and provides
 * methods to wait until all requests are complete (network idle).
 */

/**
 * Create a NetworkTracker instance for a page
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Playwright or Puppeteer page object
 * @param {string} options.engine - 'playwright' or 'puppeteer'
 * @param {Function} options.log - Logger instance
 * @param {number} options.idleTimeout - Time to wait after last request completes (default: 500ms)
 * @param {number} options.requestTimeout - Maximum time to wait for a single request (default: 30000ms)
 * @returns {Object} - NetworkTracker API
 */
export function createNetworkTracker(options = {}) {
  const {
    page,
    engine,
    log,
    idleTimeout = 500,
    requestTimeout = 30000,
  } = options;

  if (!page) {
    throw new Error('page is required in options');
  }

  // Track pending requests by URL
  const pendingRequests = new Map();

  // Track request start times for timeout detection
  const requestStartTimes = new Map();

  // Event listeners
  const listeners = {
    onRequestStart: [],
    onRequestEnd: [],
    onNetworkIdle: [],
  };

  // State
  let isTracking = false;
  let idleTimer = null;
  let navigationId = 0; // Track navigation sessions

  /**
   * Get unique request key
   */
  function getRequestKey(request) {
    // Use URL + method as unique key (handles redirects properly)
    const url = typeof request.url === 'function' ? request.url() : request.url;
    const method =
      typeof request.method === 'function' ? request.method() : request.method;
    return `${method}:${url}`;
  }

  /**
   * Handle request start
   */
  function onRequest(request) {
    const key = getRequestKey(request);
    const url = typeof request.url === 'function' ? request.url() : request.url;

    // Ignore data URLs and blob URLs
    if (url.startsWith('data:') || url.startsWith('blob:')) {
      return;
    }

    pendingRequests.set(key, request);
    requestStartTimes.set(key, Date.now());

    // Clear idle timer since we have a new request
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }

    log.debug(
      () =>
        `📤 Request started: ${url.substring(0, 80)}... (pending: ${pendingRequests.size})`
    );

    // Notify listeners
    listeners.onRequestStart.forEach((fn) =>
      fn({ url, pendingCount: pendingRequests.size })
    );
  }

  /**
   * Handle request completion (success or failure)
   */
  function onRequestEnd(request) {
    const key = getRequestKey(request);
    const url = typeof request.url === 'function' ? request.url() : request.url;

    if (!pendingRequests.has(key)) {
      return; // Request was filtered out or already completed
    }

    pendingRequests.delete(key);
    requestStartTimes.delete(key);

    log.debug(
      () =>
        `📥 Request ended: ${url.substring(0, 80)}... (pending: ${pendingRequests.size})`
    );

    // Notify listeners
    listeners.onRequestEnd.forEach((fn) =>
      fn({ url, pendingCount: pendingRequests.size })
    );

    // Check if we're now idle
    checkIdle();
  }

  /**
   * Check if network is idle and trigger idle event
   */
  function checkIdle() {
    if (pendingRequests.size === 0 && !idleTimer) {
      // Start idle timer
      idleTimer = setTimeout(() => {
        if (pendingRequests.size === 0) {
          log.debug(() => '🌐 Network idle detected');
          listeners.onNetworkIdle.forEach((fn) => fn());
        }
        idleTimer = null;
      }, idleTimeout);
    }
  }

  /**
   * Start tracking network requests
   */
  function startTracking() {
    if (isTracking) {
      return;
    }

    isTracking = true;
    navigationId++;

    // Clear any existing state
    pendingRequests.clear();
    requestStartTimes.clear();
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }

    // Setup event listeners based on engine
    if (engine === 'playwright') {
      page.on('request', onRequest);
      page.on('requestfinished', onRequestEnd);
      page.on('requestfailed', onRequestEnd);
    } else {
      // Puppeteer
      page.on('request', onRequest);
      page.on('requestfinished', onRequestEnd);
      page.on('requestfailed', onRequestEnd);
    }

    log.debug(() => '🔌 Network tracking started');
  }

  /**
   * Stop tracking network requests
   */
  function stopTracking() {
    if (!isTracking) {
      return;
    }

    isTracking = false;

    // Remove event listeners
    if (engine === 'playwright') {
      page.off('request', onRequest);
      page.off('requestfinished', onRequestEnd);
      page.off('requestfailed', onRequestEnd);
    } else {
      page.off('request', onRequest);
      page.off('requestfinished', onRequestEnd);
      page.off('requestfailed', onRequestEnd);
    }

    // Clear state
    pendingRequests.clear();
    requestStartTimes.clear();
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }

    log.debug(() => '🔌 Network tracking stopped');
  }

  /**
   * Wait for network to become idle
   * @param {Object} options - Configuration options
   * @param {number} options.timeout - Maximum time to wait (default: 30000ms)
   * @param {number} options.idleTime - Time network must be idle (default: idleTimeout)
   * @returns {Promise<boolean>} - True if idle, false if timeout
   */
  async function waitForNetworkIdle(opts = {}) {
    const { timeout = 30000, idleTime = idleTimeout } = opts;

    const startTime = Date.now();
    const currentNavId = navigationId;

    // If already idle, wait for idle time
    if (pendingRequests.size === 0) {
      await new Promise((r) => setTimeout(r, idleTime));

      // Check if still idle and no navigation happened
      if (pendingRequests.size === 0 && navigationId === currentNavId) {
        return true;
      }
    }

    return new Promise((resolve) => {
      let resolved = false;
      let checkTimer = null;
      let timeoutTimer = null;

      const cleanup = () => {
        if (checkTimer) {
          clearInterval(checkTimer);
        }
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
        }
        resolved = true;
      };

      // Timeout handler
      timeoutTimer = setTimeout(() => {
        if (!resolved) {
          cleanup();
          log.debug(
            () =>
              `⚠️  Network idle timeout after ${timeout}ms (${pendingRequests.size} pending)`
          );

          // Log stuck requests
          if (pendingRequests.size > 0) {
            const stuckRequests = [];
            for (const [key, req] of pendingRequests) {
              const startTime = requestStartTimes.get(key);
              const duration = Date.now() - startTime;
              const url = typeof req.url === 'function' ? req.url() : req.url;
              stuckRequests.push(
                `  ${url.substring(0, 60)}... (${duration}ms)`
              );
            }
            log.debug(() => `⚠️  Stuck requests:\n${stuckRequests.join('\n')}`);
          }

          resolve(false);
        }
      }, timeout);

      // Check periodically for idle state
      checkTimer = setInterval(async () => {
        if (resolved) {
          return;
        }

        // Check for navigation change (abort wait)
        if (navigationId !== currentNavId) {
          cleanup();
          resolve(false);
          return;
        }

        // Check for timed out requests and remove them
        const now = Date.now();
        for (const [key, startTime] of requestStartTimes) {
          if (now - startTime > requestTimeout) {
            log.debug(() => `⚠️  Request timed out, removing: ${key}`);
            pendingRequests.delete(key);
            requestStartTimes.delete(key);
          }
        }

        // Check if idle
        if (pendingRequests.size === 0) {
          // Wait for idle time to confirm
          await new Promise((r) => setTimeout(r, idleTime));

          if (
            !resolved &&
            pendingRequests.size === 0 &&
            navigationId === currentNavId
          ) {
            cleanup();
            resolve(true);
          }
        }
      }, 100);
    });
  }

  /**
   * Get current pending request count
   */
  function getPendingCount() {
    return pendingRequests.size;
  }

  /**
   * Get list of pending request URLs
   */
  function getPendingUrls() {
    const urls = [];
    for (const [key, req] of pendingRequests) {
      const url = typeof req.url === 'function' ? req.url() : req.url;
      urls.push(url);
    }
    return urls;
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
   * Reset tracking (clear all pending requests)
   * Called on navigation to start fresh
   */
  function reset() {
    navigationId++;
    pendingRequests.clear();
    requestStartTimes.clear();
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    log.debug(() => '🔄 Network tracker reset');
  }

  return {
    startTracking,
    stopTracking,
    waitForNetworkIdle,
    getPendingCount,
    getPendingUrls,
    reset,
    on,
    off,
  };
}
