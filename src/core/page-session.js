/**
 * PageSession - Abstraction for page lifecycle management
 *
 * A PageSession represents a single "page context" - from when a page
 * is loaded until navigation to a different page occurs.
 *
 * Key features:
 * - Automatic cleanup when navigation occurs
 * - Scope handlers to current page only
 * - Provide context for automation logic
 */

/**
 * Create a PageSession factory
 * @param {Object} options - Configuration options
 * @param {Object} options.navigationManager - NavigationManager instance
 * @param {Object} options.networkTracker - NetworkTracker instance
 * @param {Function} options.log - Logger instance
 * @returns {Object} - PageSession factory
 */
export function createPageSessionFactory(options = {}) {
  const { navigationManager, networkTracker, log } = options;

  const activeSessions = new Map();

  /**
   * Create a new PageSession for the current page
   * @param {Object} sessionOptions - Session options
   * @param {string} sessionOptions.name - Session name for debugging
   * @param {RegExp|Function} sessionOptions.urlPattern - URL pattern to match (optional)
   * @returns {Object} - PageSession instance
   */
  function createSession(sessionOptions = {}) {
    const { name = 'unnamed', urlPattern = null } = sessionOptions;

    const sessionId = navigationManager.getSessionId();
    const startUrl = navigationManager.getCurrentUrl();

    // State
    let isActive = true;
    let cleanupCallbacks = [];
    let eventListeners = [];

    log.debug(
      () =>
        `📄 Creating page session "${name}" (id: ${sessionId}) for: ${startUrl}`
    );

    /**
     * Check if URL matches the session pattern
     */
    function matchesUrl(url) {
      if (!urlPattern) {
        return true;
      }
      if (urlPattern instanceof RegExp) {
        return urlPattern.test(url);
      }
      if (typeof urlPattern === 'function') {
        return urlPattern(url);
      }
      return true;
    }

    /**
     * Handle navigation - deactivate session if URL no longer matches
     */
    function handleUrlChange({ previousUrl, newUrl }) {
      if (!isActive) {
        return;
      }

      // If we have a URL pattern, check if we're still on a matching page
      if (urlPattern && !matchesUrl(newUrl)) {
        log.debug(
          () => `📄 Session "${name}" ending - URL no longer matches: ${newUrl}`
        );
        deactivate();
      }
    }

    /**
     * Handle navigation start - cleanup before leaving
     */
    async function handleBeforeNavigate() {
      if (!isActive) {
        return;
      }

      log.debug(
        () => `📄 Session "${name}" cleanup triggered (navigation starting)`
      );
      await runCleanup();
      deactivate();
    }

    // Subscribe to navigation events
    navigationManager.on('onUrlChange', handleUrlChange);
    navigationManager.on('onBeforeNavigate', handleBeforeNavigate);

    /**
     * Run all cleanup callbacks
     */
    async function runCleanup() {
      for (const callback of cleanupCallbacks) {
        try {
          await callback();
        } catch (e) {
          log.debug(() => `⚠️  Session cleanup error: ${e.message}`);
        }
      }
      cleanupCallbacks = [];

      // Remove all event listeners
      for (const { target, event, handler } of eventListeners) {
        try {
          target.off(event, handler);
        } catch (e) {
          // Ignore removal errors
        }
      }
      eventListeners = [];
    }

    /**
     * Deactivate the session
     */
    function deactivate() {
      if (!isActive) {
        return;
      }

      isActive = false;

      // Unsubscribe from navigation events
      navigationManager.off('onUrlChange', handleUrlChange);
      navigationManager.off('onBeforeNavigate', handleBeforeNavigate);

      // Remove from active sessions
      activeSessions.delete(sessionId);

      log.debug(() => `📄 Session "${name}" deactivated`);
    }

    /**
     * Register cleanup callback
     * @param {Function} callback - Cleanup callback
     */
    function onCleanup(callback) {
      if (!isActive) {
        log.debug(
          () => `⚠️  Cannot register cleanup on inactive session "${name}"`
        );
        return;
      }
      cleanupCallbacks.push(callback);
    }

    /**
     * Run code only if session is still active
     * @param {Function} fn - Async function to run
     * @returns {Promise<any>} - Result or null if session inactive
     */
    async function ifActive(fn) {
      if (!isActive) {
        log.debug(() => `⏭️  Skipping action - session "${name}" is inactive`);
        return null;
      }
      return fn();
    }

    /**
     * Add event listener that will be cleaned up with session
     * @param {Object} target - Event target (page, navigationManager, etc.)
     * @param {string} event - Event name
     * @param {Function} handler - Event handler
     */
    function addEventListener(target, event, handler) {
      if (!isActive) {
        return;
      }

      target.on(event, handler);
      eventListeners.push({ target, event, handler });
    }

    /**
     * Check if session is still active
     */
    function checkActive() {
      return isActive;
    }

    /**
     * Get session info
     */
    function getInfo() {
      return {
        name,
        sessionId,
        startUrl,
        isActive,
        currentUrl: navigationManager.getCurrentUrl(),
      };
    }

    /**
     * Wait for network idle within this session
     */
    async function waitForNetworkIdle(opts = {}) {
      if (!isActive) {
        return false;
      }
      if (!networkTracker) {
        return true;
      }
      return networkTracker.waitForNetworkIdle(opts);
    }

    /**
     * Wait for page to be ready within this session
     */
    async function waitForPageReady(opts = {}) {
      if (!isActive) {
        return false;
      }
      return navigationManager.waitForPageReady(opts);
    }

    /**
     * Manually end the session
     */
    async function end() {
      if (!isActive) {
        return;
      }

      log.debug(() => `📄 Session "${name}" ending (manual)`);
      await runCleanup();
      deactivate();
    }

    const session = {
      // State
      get isActive() {
        return isActive;
      },
      get sessionId() {
        return sessionId;
      },
      get startUrl() {
        return startUrl;
      },
      get currentUrl() {
        return navigationManager.getCurrentUrl();
      },

      // Lifecycle
      onCleanup,
      end,
      checkActive,
      getInfo,

      // Utilities
      ifActive,
      addEventListener,
      waitForNetworkIdle,
      waitForPageReady,
    };

    // Track active session
    activeSessions.set(sessionId, session);

    return session;
  }

  /**
   * Get all active sessions
   */
  function getActiveSessions() {
    return Array.from(activeSessions.values());
  }

  /**
   * End all active sessions
   */
  async function endAllSessions() {
    const sessions = Array.from(activeSessions.values());
    for (const session of sessions) {
      await session.end();
    }
  }

  return {
    createSession,
    getActiveSessions,
    endAllSessions,
  };
}
