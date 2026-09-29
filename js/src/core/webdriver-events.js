/**
 * WebDriver BiDi events as the page events the rest of Browser Commander
 * listens to (issue #104).
 *
 * Classic WebDriver is request/response only: nothing tells the client that a
 * console message was logged, a dialog opened or a request went out. BiDi
 * does, so when the session has a BiDi connection the page facade subscribes
 * to the matching BiDi event the first time something listens for a page
 * event, and re-emits it in the Puppeteer shape:
 *
 * | page event        | BiDi event                                        |
 * | ----------------- | ------------------------------------------------- |
 * | `console`         | `log.entryAdded` (console entries)                |
 * | `pageerror`       | `log.entryAdded` (type `javascript`)              |
 * | `framenavigated`  | `browsingContext.navigationCommitted` (or         |
 * |                   | `domContentLoaded`), `fragmentNavigated`,         |
 * |                   | `historyUpdated`                                  |
 * | `domcontentloaded`| `browsingContext.domContentLoaded`                |
 * | `load`            | `browsingContext.load`                            |
 * | `dialog`          | `browsingContext.userPromptOpened`                |
 * | `request`         | `network.beforeRequestSent`                       |
 * | `requestfinished` | `network.responseCompleted`                       |
 * | `response`        | `network.responseCompleted`                       |
 * | `requestfailed`   | `network.fetchError`                              |
 *
 * Without BiDi the events stay silent, which is limitation
 * `webdriver-classic-has-no-events`.
 */

import { toConsoleMessage, toNetworkRequest } from './webdriver-conversions.js';

/**
 * The BiDi events each page event needs. Where a list has alternatives
 * (`oneOf`), the first one the driver accepts is used: older drivers do not
 * know `browsingContext.navigationCommitted`, and `domContentLoaded` is the
 * closest event every driver has.
 */
export const PAGE_EVENT_SOURCES = Object.freeze({
  console: [['log.entryAdded']],
  pageerror: [['log.entryAdded']],
  framenavigated: [
    ['browsingContext.navigationCommitted', 'browsingContext.domContentLoaded'],
    ['browsingContext.fragmentNavigated'],
    ['browsingContext.historyUpdated'],
  ],
  domcontentloaded: [['browsingContext.domContentLoaded']],
  load: [['browsingContext.load']],
  dialog: [['browsingContext.userPromptOpened']],
  request: [['network.beforeRequestSent']],
  requestfinished: [['network.responseCompleted']],
  response: [['network.responseCompleted']],
  requestfailed: [['network.fetchError']],
});

const NAVIGATION_EVENTS = new Set([
  'browsingContext.navigationCommitted',
  'browsingContext.fragmentNavigated',
  'browsingContext.historyUpdated',
]);

/**
 * A BiDi user prompt as a Puppeteer Dialog.
 *
 * @param {Object} page - The WebDriverPage the prompt belongs to
 * @param {Object} params - `browsingContext.userPromptOpened` parameters
 * @returns {Object}
 */
function toDialog(page, params) {
  const handle = (accept, userText) =>
    page.bidiCommand('browsingContext.handleUserPrompt', {
      context: params.context,
      accept,
      ...(userText !== undefined ? { userText: String(userText) } : {}),
    });
  return {
    type: () => params.type,
    message: () => params.message ?? '',
    defaultValue: () => params.defaultValue ?? '',
    accept: (promptText) => handle(true, promptText),
    dismiss: () => handle(false),
  };
}

/**
 * Bridge BiDi events onto a WebDriverPage.
 *
 * @param {Object} page - The WebDriverPage (an EventEmitter with `bidi()`)
 * @returns {{subscribe: function(string): Promise<void>, ready: function(): Promise<void>, dispose: function(): Promise<void>}}
 */
export function createWebDriverEventBridge(page) {
  const subscribed = new Map(); // page event -> Promise
  const handles = [];
  // Which BiDi method was chosen for the navigation alternative; the
  // domContentLoaded fallback also counts as a navigation then.
  let navigationSource = null;

  const isTop = (context) =>
    context === undefined || context === page.contextIdSync();

  function dispatch(method, params) {
    switch (method) {
      case 'log.entryAdded': {
        if (!isTop(params.source?.context)) {
          return;
        }
        if (params.type === 'javascript') {
          const error = new Error(params.text ?? 'Uncaught error');
          error.stackTrace = params.stackTrace;
          page.emit('pageerror', error);
        } else {
          page.emit('console', toConsoleMessage(params));
        }
        return;
      }
      case 'browsingContext.userPromptOpened':
        if (isTop(params.context)) {
          page.emit('dialog', toDialog(page, params));
        }
        return;
      case 'network.beforeRequestSent':
        page.emit('request', toNetworkRequest(params));
        return;
      case 'network.responseCompleted': {
        const request = toNetworkRequest(params);
        page.emit('response', request.response());
        page.emit('requestfinished', request);
        return;
      }
      case 'network.fetchError':
        page.emit('requestfailed', toNetworkRequest(params));
        return;
      default:
        break;
    }

    if (!isTop(params.context)) {
      return;
    }
    if (NAVIGATION_EVENTS.has(method) || method === navigationSource) {
      page.recordNavigation(params.url);
    }
    if (method === 'browsingContext.domContentLoaded') {
      page.emit('domcontentloaded');
    } else if (method === 'browsingContext.load') {
      page.emit('load');
    }
  }

  const methodHandles = new Map(); // BiDi method -> Promise<handle>

  function listen(method) {
    if (!methodHandles.has(method)) {
      methodHandles.set(
        method,
        page.subscribeBidi(method, (params) => dispatch(method, params))
      );
    }
    return methodHandles.get(method);
  }

  async function listenToFirstSupported(alternatives) {
    let lastError = null;
    for (const method of alternatives) {
      try {
        const handle = await listen(method);
        handles.push(handle);
        if (alternatives.length > 1) {
          navigationSource = method;
        }
        return;
      } catch (error) {
        methodHandles.delete(method);
        lastError = error;
      }
    }
    throw lastError;
  }

  async function subscribeSources(eventName) {
    const bidi = await page.bidi();
    if (!bidi) {
      return;
    }
    // Events are filtered to the page's own browsing context, so its id has
    // to be known before the first one arrives.
    await page.contextId();
    for (const alternatives of PAGE_EVENT_SOURCES[eventName]) {
      await listenToFirstSupported(alternatives);
    }
  }

  return {
    /**
     * Make sure the BiDi events behind a page event are subscribed.
     * Unknown event names and classic sessions are a no-op.
     *
     * @param {string} eventName
     * @returns {Promise<void>}
     */
    subscribe(eventName) {
      if (!PAGE_EVENT_SOURCES[eventName]) {
        return Promise.resolve();
      }
      if (!subscribed.has(eventName)) {
        const pending = subscribeSources(eventName).catch((error) => {
          page.recordBridgeError(eventName, error);
        });
        subscribed.set(eventName, pending);
      }
      return subscribed.get(eventName);
    },

    /** Resolves once every subscription requested so far is in place. */
    async ready() {
      await Promise.all(subscribed.values());
    },

    /** Remove every BiDi subscription the bridge made. */
    async dispose() {
      const all = [...new Set(handles)];
      handles.length = 0;
      subscribed.clear();
      methodHandles.clear();
      await Promise.all(
        all.map((handle) => Promise.resolve(handle?.unsubscribe?.()))
      ).catch(() => {});
    },
  };
}
