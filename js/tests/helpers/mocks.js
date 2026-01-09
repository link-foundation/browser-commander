/**
 * Mock utilities for unit tests
 */

/**
 * Create a mock Playwright page object
 */
export function createMockPlaywrightPage(options = {}) {
  const {
    url = 'https://example.com',
    elements = {},
    evaluateResult = null,
  } = options;

  const eventListeners = new Map();

  const locatorMock = (selector) => {
    const elementData = elements[selector] || {
      count: 1,
      visible: true,
      enabled: true,
      textContent: 'Mock text',
      value: '',
      className: 'mock-class',
    };

    return {
      count: async () => elementData.count,
      first() {
        return this;
      },
      nth(i) {
        return this;
      },
      last() {
        return this;
      },
      click: async (opts = {}) => {},
      fill: async (text) => {
        elementData.value = text;
      },
      type: async (text) => {
        elementData.value = text;
      },
      focus: async () => {},
      textContent: async () => elementData.textContent,
      inputValue: async () => elementData.value,
      getAttribute: async (name) => elementData[name] || null,
      isVisible: async () => elementData.visible,
      waitFor: async (opts = {}) => {
        if (!elementData.visible && opts.state === 'visible') {
          throw new Error('Element not visible');
        }
      },
      evaluate: async (fn, arg) => {
        const mockEl = {
          tagName: 'DIV',
          textContent: elementData.textContent,
          value: elementData.value,
          className: elementData.className,
          disabled: !elementData.enabled,
          checked: elementData.checked || false,
          isConnected: true,
          offsetWidth: elementData.visible ? 100 : 0,
          offsetHeight: elementData.visible ? 50 : 0,
          hasAttribute: (attr) => !!elementData[attr],
          getAttribute: (attr) => elementData[attr] || null,
          classList: {
            contains: (cls) => elementData.className?.includes(cls) || false,
          },
          getBoundingClientRect: () => ({
            top: 100,
            bottom: 150,
            left: 10,
            right: 110,
            width: 100,
            height: 50,
          }),
          scrollIntoView: () => {},
          dispatchEvent: () => {},
        };
        return fn(mockEl, arg);
      },
    };
  };

  return {
    _isPlaywrightPage: true,
    url: () => url,
    goto: async (targetUrl, opts = {}) => {},
    waitForNavigation: async (opts = {}) => {},
    waitForSelector: async (sel, opts = {}) => locatorMock(sel),
    $: async (sel) => locatorMock(sel),
    $$: async (sel) => {
      const count = elements[sel]?.count || 1;
      return Array(count).fill(locatorMock(sel));
    },
    $eval: async (sel, fn, ...args) => {
      const loc = locatorMock(sel);
      return loc.evaluate(fn, ...args);
    },
    $$eval: async (sel, fn, ...args) => {
      const count = elements[sel]?.count || 1;
      const locs = Array(count).fill(locatorMock(sel));
      return locs.map((l) => l.evaluate(fn, ...args));
    },
    locator: locatorMock,
    // Playwright's page.evaluate() only accepts a single argument (not spread)
    // This is the key difference from Puppeteer
    evaluate: async (fn, arg) => {
      if (evaluateResult !== null) {
        return evaluateResult;
      }
      try {
        // Playwright passes exactly one argument (can be object/array)
        return fn(arg);
      } catch {
        return fn;
      }
    },
    mainFrame: () => ({
      url: () => url,
    }),
    context: () => ({}),
    bringToFront: async () => {},
    on: (event, handler) => {
      if (!eventListeners.has(event)) {
        eventListeners.set(event, []);
      }
      eventListeners.get(event).push(handler);
    },
    off: (event, handler) => {
      const handlers = eventListeners.get(event);
      if (handlers) {
        const idx = handlers.indexOf(handler);
        if (idx !== -1) {
          handlers.splice(idx, 1);
        }
      }
    },
    emit: (event, data) => {
      const handlers = eventListeners.get(event);
      if (handlers) {
        handlers.forEach((h) => h(data));
      }
    },
    click: async (sel, opts = {}) => {},
    type: async (sel, text, opts = {}) => {},
    keyboard: {
      type: async (text) => {},
    },
  };
}

/**
 * Create a mock Puppeteer page object
 */
export function createMockPuppeteerPage(options = {}) {
  const {
    url = 'https://example.com',
    elements = {},
    evaluateResult = null,
  } = options;

  const eventListeners = new Map();

  const elementMock = (selector) => {
    const elementData = elements[selector] || {
      count: 1,
      visible: true,
      enabled: true,
      textContent: 'Mock text',
      value: '',
      className: 'mock-class',
    };

    return {
      click: async (opts = {}) => {},
      focus: async () => {},
      type: async (text) => {
        elementData.value = text;
      },
      evaluate: async (fn, ...args) =>
        page.evaluate(fn, elementMock(selector), ...args),
    };
  };

  const page = {
    _isPuppeteerPage: true,
    url: () => url,
    goto: async (targetUrl, opts = {}) => {},
    waitForNavigation: async (opts = {}) => {},
    waitForSelector: async (sel, opts = {}) => elementMock(sel),
    $: async (sel) => {
      const elementData = elements[sel];
      if (elementData?.count === 0) {
        return null;
      }
      return elementMock(sel);
    },
    $$: async (sel) => {
      const count = elements[sel]?.count || 1;
      return Array(count)
        .fill(null)
        .map(() => elementMock(sel));
    },
    $eval: async (sel, fn, ...args) => {
      const elementData = elements[sel] || {};
      const mockEl = {
        tagName: 'DIV',
        textContent: elementData.textContent || 'Mock text',
        value: elementData.value || '',
        className: elementData.className || 'mock-class',
        disabled: !elementData.enabled,
        checked: elementData.checked || false,
        isConnected: true,
        offsetWidth: elementData.visible !== false ? 100 : 0,
        offsetHeight: elementData.visible !== false ? 50 : 0,
        hasAttribute: (attr) => !!elementData[attr],
        getAttribute: (attr) => elementData[attr] || null,
        classList: {
          contains: (cls) => elementData.className?.includes(cls) || false,
        },
        getBoundingClientRect: () => ({
          top: 100,
          bottom: 150,
          left: 10,
          right: 110,
          width: 100,
          height: 50,
        }),
        scrollIntoView: () => {},
        dispatchEvent: () => {},
      };
      return fn(mockEl, ...args);
    },
    $$eval: async (sel, fn, ...args) => {
      const count = elements[sel]?.count || 1;
      return fn(Array(count).fill({}), ...args);
    },
    evaluate: async (fn, ...args) => {
      if (evaluateResult !== null) {
        return evaluateResult;
      }
      try {
        // For element evaluations, first arg might be an element mock
        if (args[0] && typeof args[0] === 'object' && args[0].click) {
          const mockEl = {
            tagName: 'DIV',
            textContent: 'Mock text',
            value: '',
            className: 'mock-class',
            disabled: false,
            checked: false,
            isConnected: true,
            offsetWidth: 100,
            offsetHeight: 50,
            hasAttribute: () => false,
            getAttribute: () => null,
            classList: { contains: () => false },
            getBoundingClientRect: () => ({
              top: 100,
              bottom: 150,
              left: 10,
              right: 110,
              width: 100,
              height: 50,
            }),
            scrollIntoView: () => {},
            dispatchEvent: () => {},
          };
          return fn(mockEl, ...args.slice(1));
        }
        return fn(...args);
      } catch {
        return fn;
      }
    },
    mainFrame: () => ({
      url: () => url,
    }),
    bringToFront: async () => {},
    on: (event, handler) => {
      if (!eventListeners.has(event)) {
        eventListeners.set(event, []);
      }
      eventListeners.get(event).push(handler);
    },
    off: (event, handler) => {
      const handlers = eventListeners.get(event);
      if (handlers) {
        const idx = handlers.indexOf(handler);
        if (idx !== -1) {
          handlers.splice(idx, 1);
        }
      }
    },
    emit: (event, data) => {
      const handlers = eventListeners.get(event);
      if (handlers) {
        handlers.forEach((h) => h(data));
      }
    },
    click: async (sel, opts = {}) => {},
    type: async (sel, text, opts = {}) => {},
    keyboard: {
      type: async (text) => {},
    },
  };

  return page;
}

/**
 * Create a mock logger
 */
export function createMockLogger(options = {}) {
  const { collectLogs = false } = options;
  const logs = [];

  return {
    debug: (fn) => {
      if (collectLogs) {
        logs.push({
          level: 'debug',
          message: typeof fn === 'function' ? fn() : fn,
        });
      }
    },
    info: (fn) => {
      if (collectLogs) {
        logs.push({
          level: 'info',
          message: typeof fn === 'function' ? fn() : fn,
        });
      }
    },
    warn: (fn) => {
      if (collectLogs) {
        logs.push({
          level: 'warn',
          message: typeof fn === 'function' ? fn() : fn,
        });
      }
    },
    error: (fn) => {
      if (collectLogs) {
        logs.push({
          level: 'error',
          message: typeof fn === 'function' ? fn() : fn,
        });
      }
    },
    getLogs: () => logs,
    clear: () => {
      logs.length = 0;
    },
  };
}

/**
 * Create a mock network tracker
 */
export function createMockNetworkTracker(options = {}) {
  const { initialPendingCount = 0, waitForIdleResult = true } = options;

  let pendingCount = initialPendingCount;
  const listeners = {
    onRequestStart: [],
    onRequestEnd: [],
    onNetworkIdle: [],
  };

  return {
    startTracking: () => {},
    stopTracking: () => {},
    waitForNetworkIdle: async (opts = {}) => waitForIdleResult,
    getPendingCount: () => pendingCount,
    getPendingUrls: () => [],
    reset: () => {
      pendingCount = 0;
    },
    on: (event, callback) => {
      if (listeners[event]) {
        listeners[event].push(callback);
      }
    },
    off: (event, callback) => {
      if (listeners[event]) {
        const idx = listeners[event].indexOf(callback);
        if (idx !== -1) {
          listeners[event].splice(idx, 1);
        }
      }
    },
    setPendingCount: (count) => {
      pendingCount = count;
    },
  };
}

/**
 * Create a mock navigation manager
 */
export function createMockNavigationManager(options = {}) {
  const {
    currentUrl = 'https://example.com',
    isNavigating = false,
    shouldAbortValue = false,
  } = options;

  let url = currentUrl;
  let navigating = isNavigating;
  const sessionId = 1;
  let abortController = new AbortController();
  const listeners = {
    onNavigationStart: [],
    onNavigationComplete: [],
    onBeforeNavigate: [],
    onUrlChange: [],
    onPageReady: [],
  };

  return {
    navigate: async (opts = {}) => {
      url = opts.url || url;
      return true;
    },
    waitForNavigation: async (opts = {}) => true,
    waitForPageReady: async (opts = {}) => true,
    isNavigating: () => navigating,
    getCurrentUrl: () => url,
    getSessionId: () => sessionId,
    getAbortSignal: () => abortController.signal,
    shouldAbort: () => shouldAbortValue,
    onSessionCleanup: (callback) => {},
    on: (event, callback) => {
      if (listeners[event]) {
        listeners[event].push(callback);
      }
    },
    off: (event, callback) => {
      if (listeners[event]) {
        const idx = listeners[event].indexOf(callback);
        if (idx !== -1) {
          listeners[event].splice(idx, 1);
        }
      }
    },
    startListening: () => {},
    stopListening: () => {},
    configure: (config) => {},
    setUrl: (newUrl) => {
      url = newUrl;
    },
    setNavigating: (val) => {
      navigating = val;
    },
    triggerEvent: (event, data) => {
      if (listeners[event]) {
        listeners[event].forEach((cb) => cb(data));
      }
    },
    abort: () => {
      abortController.abort();
    },
    resetAbort: () => {
      abortController = new AbortController();
    },
  };
}

/**
 * Create navigation error for testing
 */
export function createNavigationError(
  message = 'Execution context was destroyed'
) {
  const error = new Error(message);
  error.name = 'NavigationError';
  return error;
}

/**
 * Simple assertion helpers that work with Node.js test runner
 */
export const assert = {
  equal: (actual, expected, message = '') => {
    if (actual !== expected) {
      throw new Error(`${message}: Expected ${expected}, got ${actual}`);
    }
  },
  deepEqual: (actual, expected, message = '') => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${message}: Objects not equal`);
    }
  },
  ok: (value, message = '') => {
    if (!value) {
      throw new Error(`${message}: Expected truthy value, got ${value}`);
    }
  },
  notOk: (value, message = '') => {
    if (value) {
      throw new Error(`${message}: Expected falsy value, got ${value}`);
    }
  },
  throws: async (fn, expectedError, message = '') => {
    try {
      await fn();
      throw new Error(`${message}: Expected function to throw`);
    } catch (error) {
      if (expectedError && !error.message.includes(expectedError)) {
        throw new Error(
          `${message}: Expected error message to include "${expectedError}", got "${error.message}"`
        );
      }
    }
  },
  doesNotThrow: async (fn, message = '') => {
    try {
      await fn();
    } catch (error) {
      throw new Error(
        `${message}: Expected function not to throw, but got: ${error.message}`
      );
    }
  },
};
