/**
 * PageTriggerManager - Manages stoppable page triggers with proper lifecycle
 *
 * Key guarantees:
 * 1. Only one action runs at a time
 * 2. Action is fully stopped before page loading starts
 * 3. Action can gracefully cleanup on stop
 * 4. All commander operations throw ActionStoppedError when stopped
 *
 * Terminology:
 * - Trigger: A condition + action pair that fires when condition is met
 * - Condition: A function that returns true/false to determine if trigger should fire
 * - Action: The async function that runs when condition is true
 */

/**
 * Error thrown when action is stopped (navigation detected)
 * Actions can catch this to do cleanup, but should re-throw or return
 */
export class ActionStoppedError extends Error {
  constructor(message = 'Action stopped due to navigation') {
    super(message);
    this.name = 'ActionStoppedError';
    this.isActionStopped = true;
  }
}

/**
 * Check if error is an ActionStoppedError
 * @param {Error} error - Error to check
 * @returns {boolean}
 */
export function isActionStoppedError(error) {
  return (
    error &&
    (error.isActionStopped === true || error.name === 'ActionStoppedError')
  );
}

/**
 * Create a URL condition matcher (similar to express router patterns)
 *
 * @param {string|RegExp|Function} pattern - URL pattern to match
 *   - String: Exact match or pattern with :param placeholders (like express)
 *   - RegExp: Regular expression to test against URL
 *   - Function: Custom function (url, ctx) => boolean
 * @returns {Function} - Condition function (ctx) => boolean
 *
 * @example
 * // Exact match
 * makeUrlCondition('https://example.com/page')
 *
 * // Pattern with parameters (express-style)
 * makeUrlCondition('/vacancy/:id')
 * makeUrlCondition('https://hh.ru/vacancy/:vacancyId')
 *
 * // Contains substring
 * makeUrlCondition('*checkout*')  // matches any URL containing 'checkout'
 *
 * // RegExp
 * makeUrlCondition(/\/product\/\d+/)
 *
 * // Custom function
 * makeUrlCondition((url, ctx) => url.includes('/admin') && url.includes('edit'))
 */
export function makeUrlCondition(pattern) {
  // If already a function, wrap it to receive context
  if (typeof pattern === 'function') {
    return (ctx) => pattern(ctx.url, ctx);
  }

  // RegExp pattern
  if (pattern instanceof RegExp) {
    return (ctx) => pattern.test(ctx.url);
  }

  // String pattern
  if (typeof pattern === 'string') {
    // Wildcard pattern: *substring* means "contains"
    if (pattern.startsWith('*') && pattern.endsWith('*')) {
      const substring = pattern.slice(1, -1);
      return (ctx) => ctx.url.includes(substring);
    }

    // Starts with wildcard: *suffix means "ends with"
    if (pattern.startsWith('*')) {
      const suffix = pattern.slice(1);
      return (ctx) => ctx.url.endsWith(suffix);
    }

    // Ends with wildcard: prefix* means "starts with"
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return (ctx) => ctx.url.startsWith(prefix);
    }

    // Express-style pattern with :params
    if (pattern.includes(':')) {
      // Convert express pattern to regex
      // /vacancy/:id -> /vacancy/([^/]+)
      // /user/:userId/profile -> /user/([^/]+)/profile
      const regexPattern = pattern
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape special chars first
        .replace(/\\:/g, ':') // Unescape colons we just escaped
        .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '([^/&?#]+)'); // Replace :param with capture group

      const regex = new RegExp(regexPattern);
      return (ctx) => regex.test(ctx.url);
    }

    // Simple substring match (no wildcards, no params)
    // If it looks like a full URL, do exact match
    if (pattern.startsWith('http://') || pattern.startsWith('https://')) {
      return (ctx) =>
        ctx.url === pattern ||
        ctx.url.startsWith(`${pattern}?`) ||
        ctx.url.startsWith(`${pattern}#`);
    }

    // Otherwise, treat as path pattern - match if URL contains this path
    return (ctx) => ctx.url.includes(pattern);
  }

  throw new Error(
    `Invalid URL pattern type: ${typeof pattern}. Expected string, RegExp, or function.`
  );
}

/**
 * Combine multiple conditions with AND logic
 * @param {...Function} conditions - Condition functions to combine
 * @returns {Function} - Combined condition function
 */
export function allConditions(...conditions) {
  return (ctx) => conditions.every((cond) => cond(ctx));
}

/**
 * Combine multiple conditions with OR logic
 * @param {...Function} conditions - Condition functions to combine
 * @returns {Function} - Combined condition function
 */
export function anyCondition(...conditions) {
  return (ctx) => conditions.some((cond) => cond(ctx));
}

/**
 * Negate a condition
 * @param {Function} condition - Condition function to negate
 * @returns {Function} - Negated condition function
 */
export function notCondition(condition) {
  return (ctx) => !condition(ctx);
}

/**
 * Create a PageTriggerManager instance
 * @param {Object} options - Configuration options
 * @param {Object} options.navigationManager - NavigationManager instance
 * @param {Function} options.log - Logger instance
 * @returns {Object} - PageTriggerManager API
 */
export function createPageTriggerManager(options = {}) {
  const { navigationManager, log } = options;

  if (!navigationManager) {
    throw new Error('navigationManager is required');
  }

  // Registered triggers
  const triggers = [];

  // Current action state
  let currentTrigger = null;
  let currentAbortController = null;
  let actionPromise = null;
  let actionStopPromise = null;
  let actionStopResolve = null;
  let isActionRunning = false;
  let isStopping = false;

  /**
   * Register a page trigger
   * @param {Object} config - Trigger configuration
   * @param {Function} config.condition - Function (ctx) => boolean, returns true if trigger should fire
   * @param {Function} config.action - Async function (ctx) => void, the action to run
   * @param {string} config.name - Trigger name for debugging
   * @param {number} config.priority - Priority (higher runs first if multiple match), default 0
   * @returns {Function} - Unregister function
   */
  function pageTrigger(config) {
    const { condition, action, name = 'unnamed', priority = 0 } = config;

    if (typeof condition !== 'function') {
      throw new Error('condition must be a function');
    }
    if (typeof action !== 'function') {
      throw new Error('action must be a function');
    }

    const triggerConfig = {
      condition,
      action,
      name,
      priority,
    };

    triggers.push(triggerConfig);

    // Sort by priority (descending)
    triggers.sort((a, b) => b.priority - a.priority);

    log.debug(
      () => `📋 Registered page trigger: "${name}" (priority: ${priority})`
    );

    // Return unregister function
    return () => {
      const index = triggers.indexOf(triggerConfig);
      if (index !== -1) {
        triggers.splice(index, 1);
        log.debug(() => `📋 Unregistered page trigger: "${name}"`);
      }
    };
  }

  /**
   * Find matching trigger for context
   * @param {Object} ctx - Context with url and other properties
   * @returns {Object|null} - Matching trigger config or null
   */
  function findMatchingTrigger(ctx) {
    for (const config of triggers) {
      try {
        if (config.condition(ctx)) {
          return config;
        }
      } catch (e) {
        log.debug(
          () => `⚠️  Error in condition for "${config.name}": ${e.message}`
        );
      }
    }
    return null;
  }

  /**
   * Stop current action and wait for it to finish
   * @returns {Promise<void>}
   */
  async function stopCurrentAction() {
    if (!isActionRunning) {
      return;
    }

    if (isStopping) {
      // Already stopping, wait for it
      if (actionStopPromise) {
        await actionStopPromise;
      }
      return;
    }

    isStopping = true;
    log.debug(() => `🛑 Stopping action "${currentTrigger?.name}"...`);

    // Create promise that resolves when action actually stops
    actionStopPromise = new Promise((resolve) => {
      actionStopResolve = resolve;
    });

    // Abort the action
    if (currentAbortController) {
      currentAbortController.abort();
    }

    // Wait for action to finish (with timeout)
    const timeoutMs = 10000; // 10 second max wait
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => {
        log.debug(
          () =>
            `⚠️  Action "${currentTrigger?.name}" did not stop gracefully within ${timeoutMs}ms`
        );
        resolve();
      }, timeoutMs);
    });

    await Promise.race([actionPromise, timeoutPromise]);

    // Cleanup
    isActionRunning = false;
    isStopping = false;
    currentTrigger = null;
    currentAbortController = null;
    actionPromise = null;

    // Resolve the stop promise
    if (actionStopResolve) {
      actionStopResolve();
      actionStopResolve = null;
      actionStopPromise = null;
    }

    log.debug(() => '✅ Action stopped');
  }

  /**
   * Start action for URL
   * @param {string} url - URL to start action for
   * @param {Object} commander - BrowserCommander instance
   */
  async function startAction(url, commander) {
    // Create context for condition checking
    const conditionCtx = {
      url,
      commander,
    };

    // Find matching trigger
    const matchingTrigger = findMatchingTrigger(conditionCtx);
    if (!matchingTrigger) {
      log.debug(() => `📋 No trigger registered for: ${url}`);
      return;
    }

    log.debug(() => `🚀 Starting action "${matchingTrigger.name}" for: ${url}`);

    // Setup abort controller
    currentAbortController = new AbortController();
    currentTrigger = matchingTrigger;
    isActionRunning = true;

    // Create action context
    const context = createActionContext({
      url,
      abortSignal: currentAbortController.signal,
      commander,
      triggerName: matchingTrigger.name,
    });

    // Run action
    actionPromise = (async () => {
      try {
        await matchingTrigger.action(context);
        log.debug(
          () => `✅ Action "${matchingTrigger.name}" completed normally`
        );
      } catch (error) {
        if (isActionStoppedError(error)) {
          log.debug(
            () =>
              `🛑 Action "${matchingTrigger.name}" stopped (caught ActionStoppedError)`
          );
        } else if (error.name === 'AbortError') {
          log.debug(() => `🛑 Action "${matchingTrigger.name}" aborted`);
        } else {
          log.debug(
            () => `❌ Action "${matchingTrigger.name}" error: ${error.message}`
          );
          console.error(`Action "${matchingTrigger.name}" error:`, error);
        }
      } finally {
        // Only clear if this is still the current trigger
        if (currentTrigger === matchingTrigger) {
          isActionRunning = false;
          currentTrigger = null;
          currentAbortController = null;
        }
      }
    })();
  }

  /**
   * Create action context with abort-aware commander wrapper
   * @param {Object} options
   * @returns {Object} - Action context
   */
  function createActionContext(options) {
    const { url, abortSignal, commander, triggerName } = options;

    /**
     * Check if stopped and throw if so
     */
    function checkStopped() {
      if (abortSignal.aborted) {
        throw new ActionStoppedError(`Action "${triggerName}" stopped`);
      }
    }

    /**
     * Wrap async function to check abort before and after
     */
    function wrapAsync(fn) {
      return async (...args) => {
        checkStopped();
        const result = await fn(...args);
        checkStopped();
        return result;
      };
    }

    /**
     * Create abort-aware loop helper
     * Use this instead of for/while loops for stoppability
     */
    async function forEach(items, callback) {
      for (let i = 0; i < items.length; i++) {
        checkStopped();
        await callback(items[i], i, items);
      }
    }

    /**
     * Wait with abort support
     */
    async function wait(ms) {
      checkStopped();
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(resolve, ms);
        abortSignal.addEventListener(
          'abort',
          () => {
            clearTimeout(timeout);
            reject(new ActionStoppedError());
          },
          { once: true }
        );
      });
    }

    /**
     * Register cleanup callback (called when action stops)
     */
    const cleanupCallbacks = [];
    function onCleanup(callback) {
      cleanupCallbacks.push(callback);
      abortSignal.addEventListener(
        'abort',
        async () => {
          try {
            await callback();
          } catch (e) {
            log.debug(() => `⚠️  Cleanup error: ${e.message}`);
          }
        },
        { once: true }
      );
    }

    // Wrap all commander methods to be abort-aware
    const wrappedCommander = {};
    for (const [key, value] of Object.entries(commander)) {
      if (
        typeof value === 'function' &&
        key !== 'destroy' &&
        key !== 'pageTrigger'
      ) {
        wrappedCommander[key] = wrapAsync(value);
      } else {
        wrappedCommander[key] = value;
      }
    }

    return {
      // URL this action is running for
      url,

      // Abort signal - use with fetch() or custom abort logic
      abortSignal,

      // Check if action should stop
      isStopped: () => abortSignal.aborted,

      // Throw if stopped - call this in loops
      checkStopped,

      // Abort-aware iteration helper
      forEach,

      // Abort-aware wait
      wait,

      // Register cleanup callback
      onCleanup,

      // Wrapped commander - all methods throw ActionStoppedError if stopped
      commander: wrappedCommander,

      // Original commander (use carefully)
      rawCommander: commander,

      // Trigger name for debugging
      triggerName,
    };
  }

  /**
   * Handle navigation start - stop current action first
   */
  async function onNavigationStart() {
    await stopCurrentAction();
  }

  /**
   * Handle page ready - start matching action
   */
  async function onPageReady({ url }, commander) {
    await startAction(url, commander);
  }

  /**
   * Check if an action is currently running
   */
  function isRunning() {
    return isActionRunning;
  }

  /**
   * Get current trigger name
   */
  function getCurrentTriggerName() {
    return currentTrigger?.name || null;
  }

  /**
   * Initialize - connect to navigation manager
   * @param {Object} commander - BrowserCommander instance
   */
  function initialize(commander) {
    // Stop action before navigation starts
    navigationManager.on('onBeforeNavigate', onNavigationStart);

    // Start action when page is ready
    navigationManager.on('onPageReady', (event) =>
      onPageReady(event, commander)
    );

    log.debug(() => '📋 PageTriggerManager initialized');
  }

  /**
   * Cleanup
   */
  async function destroy() {
    await stopCurrentAction();
    triggers.length = 0;
    navigationManager.off('onBeforeNavigate', onNavigationStart);
    log.debug(() => '📋 PageTriggerManager destroyed');
  }

  return {
    pageTrigger,
    stopCurrentAction,
    getCurrentTriggerName,
    isRunning,
    initialize,
    destroy,

    // Export error class and checker
    ActionStoppedError,
    isActionStoppedError,
  };
}
