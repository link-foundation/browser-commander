/**
 * A fake `chrome` namespace and browser `WebSocket` for the companion
 * extension tests (issue #102, addendum, mode 2).
 *
 * The extension code in js/extension only touches the handful of APIs below,
 * so the relay handler and its service-worker client run unchanged in Node.
 */
import { connectWebSocket } from '../../src/browser/attach/websocket.js';

/** A `chrome.*.onSomething` event whose listeners the test can fire. */
function fakeEvent() {
  const listeners = [];
  return {
    listeners,
    addListener: (listener) => listeners.push(listener),
    fire: (...args) => listeners.forEach((listener) => listener(...args)),
  };
}

/**
 * @param {Object} [options]
 * @param {Array<Object>} [options.tabs] - `chrome.tabs.Tab`-like objects
 * @param {Object} [options.storage] - `chrome.storage.local` contents
 * @returns {Object} The fake namespace; `calls` records every API call
 */
export function createFakeChrome({ tabs = [], storage = {} } = {}) {
  const calls = [];
  let nextTabId = 100;
  const chrome = {
    calls,
    tabs: {
      query: async (query) => {
        calls.push(['tabs.query', query]);
        return tabs;
      },
      create: async (properties) => {
        calls.push(['tabs.create', properties]);
        const tab = { id: nextTabId++, pendingUrl: properties.url };
        tabs.push(tab);
        return tab;
      },
    },
    debugger: {
      attach: async (target, version) => {
        calls.push(['debugger.attach', target.tabId, version]);
      },
      detach: async (target) => {
        calls.push(['debugger.detach', target.tabId]);
      },
      sendCommand: async (target, method, params) => {
        calls.push(['debugger.sendCommand', target.tabId, method, params]);
        if (method === 'Bad.method') {
          throw new Error("'Bad.method' wasn't found");
        }
        return method === 'Runtime.evaluate'
          ? { result: { type: 'number', value: 2 } }
          : undefined;
      },
      onEvent: fakeEvent(),
      onDetach: fakeEvent(),
    },
    alarms: {
      create: (name, info) => calls.push(['alarms.create', name, info]),
      onAlarm: fakeEvent(),
    },
    storage: {
      local: { get: async (key) => ({ [key]: storage[key] }) },
      onChanged: fakeEvent(),
    },
    runtime: {
      getManifest: () => ({ version: '1.2.3' }),
      onStartup: fakeEvent(),
      onInstalled: fakeEvent(),
    },
  };
  return chrome;
}

/**
 * The browser `WebSocket` API on top of {@link connectWebSocket}, sending the
 * `Origin` an extension service worker sends.
 */
export function createExtensionWebSocket(origin = 'chrome-extension://abc') {
  return class ExtensionWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;

    constructor(url) {
      this.url = url;
      this.readyState = ExtensionWebSocket.CONNECTING;
      connectWebSocket(url, { headers: { Origin: origin } }).then(
        (connection) => {
          this.connection = connection;
          this.readyState = ExtensionWebSocket.OPEN;
          connection.on('message', (data) => this.onmessage?.({ data }));
          connection.on('error', () => {});
          connection.once('close', () => this.closed());
          this.onopen?.();
        },
        (error) => {
          this.error = error;
          this.onerror?.(error);
          this.closed();
        }
      );
    }

    send(text) {
      this.connection.send(text);
    }

    close() {
      this.connection?.close();
    }

    closed() {
      if (this.readyState !== ExtensionWebSocket.CLOSED) {
        this.readyState = ExtensionWebSocket.CLOSED;
        this.onclose?.();
      }
    }
  };
}
