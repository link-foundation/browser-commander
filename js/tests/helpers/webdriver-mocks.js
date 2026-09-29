/**
 * Stand-ins for a selenium-webdriver WebDriver, its WebElements and its BiDi
 * connection (issue #104). Every call is recorded in `calls` so tests can
 * assert on the WebDriver commands an operation produced.
 */

/**
 * A mock WebElement.
 *
 * @param {Object} [options]
 * @param {boolean} [options.displayed=true]
 * @param {Array} [calls] - Shared call log
 * @returns {Object}
 */
export function createMockWebElement(
  { displayed = true, id = 'el' } = {},
  calls = []
) {
  return {
    id,
    displayed,
    click: async () => {
      calls.push(['element.click', id]);
    },
    sendKeys: async (...keys) => {
      calls.push(['element.sendKeys', id, ...keys]);
    },
    clear: async () => {
      calls.push(['element.clear', id]);
    },
    async isDisplayed() {
      return this.displayed;
    },
  };
}

function createMockActions(calls) {
  const steps = [];
  const chain = {};
  for (const name of [
    'move',
    'press',
    'release',
    'keyDown',
    'keyUp',
    'sendKeys',
    'pause',
    'scroll',
    'click',
  ]) {
    chain[name] = (...args) => {
      steps.push([name, ...args]);
      return chain;
    };
  }
  chain.perform = async () => {
    calls.push(['actions', steps]);
  };
  return chain;
}

/**
 * A mock WebDriver.
 *
 * @param {Object} [options]
 * @param {string} [options.url='about:blank']
 * @param {Object} [options.capabilities] - e.g. {webSocketUrl: 'ws://...'}
 * @param {Object<string, Object[]>} [options.elements] - CSS selector -> elements
 * @param {Function} [options.script] - (script, args) => value returned by the page function
 * @returns {Object}
 */
export function createMockDriver({
  url = 'about:blank',
  capabilities = {},
  elements = {},
  script = () => undefined,
  cookies = [],
} = {}) {
  const calls = [];
  const state = { url, cookies: [...cookies] };
  const driver = {
    calls,
    state,
    getCurrentUrl: async () => state.url,
    get: async (target) => {
      calls.push(['get', target]);
      state.url = target;
    },
    getTitle: async () => 'Mock title',
    getPageSource: async () => '<html></html>',
    getWindowHandle: async () => 'context-1',
    getCapabilities: async () => ({ get: (name) => capabilities[name] }),
    findElements: async (locator) => {
      calls.push(['findElements', locator]);
      return elements[locator.css] ?? [];
    },
    executeScript: async (source, ...args) => {
      calls.push(['executeScript', source, args]);
      return [await script(source, args), state.url];
    },
    manage: () => ({
      getCookies: async () => state.cookies,
      addCookie: async (cookie) => {
        calls.push(['addCookie', cookie]);
        state.cookies.push(cookie);
      },
      deleteCookie: async (name) => {
        calls.push(['deleteCookie', name]);
        state.cookies = state.cookies.filter((c) => c.name !== name);
      },
      setTimeouts: async (timeouts) => {
        calls.push(['setTimeouts', timeouts]);
      },
    }),
    navigate: () => ({
      back: async () => calls.push(['back']),
      forward: async () => calls.push(['forward']),
      refresh: async () => calls.push(['refresh']),
    }),
    switchTo: () => ({
      window: async (handle) => calls.push(['switchTo.window', handle]),
    }),
    actions: (options) => {
      calls.push(['actions.new', options]);
      return createMockActions(calls);
    },
    takeScreenshot: async () => Buffer.from('png').toString('base64'),
    printPage: async (options) => {
      calls.push(['printPage', options]);
      return Buffer.from('%PDF-mock').toString('base64');
    },
    close: async () => calls.push(['close']),
    quit: async () => calls.push(['quit']),
  };
  return driver;
}

/**
 * A mock BiDi connection: `send` answers from `responses`, `addCallback`
 * records handlers that `fire(method, params)` invokes.
 *
 * @param {Object} [options]
 * @param {Object<string, Object|Function>} [options.responses] - method -> result (or params => result)
 * @param {string[]} [options.unsupported] - Event methods that fail to subscribe
 * @returns {Object}
 */
export function createMockBidi({ responses = {}, unsupported = [] } = {}) {
  const sent = [];
  const callbacks = new Map();
  const unsubscribed = [];
  return {
    sent,
    callbacks,
    unsubscribed,
    send: async ({ method, params }) => {
      sent.push({ method, params });
      const response = responses[method];
      if (response?.error) {
        return response;
      }
      return {
        type: 'success',
        result:
          typeof response === 'function' ? response(params) : (response ?? {}),
      };
    },
    addCallback: async (method, handler) => {
      if (unsupported.includes(method)) {
        throw new Error(`invalid argument: ${method} is not a known event`);
      }
      callbacks.set(method, handler);
      return {
        unsubscribe: async () => {
          unsubscribed.push(method);
          callbacks.delete(method);
        },
      };
    },
    fire(method, params) {
      callbacks.get(method)?.(params);
    },
  };
}
