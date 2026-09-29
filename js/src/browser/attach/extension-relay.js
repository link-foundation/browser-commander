import { EventEmitter } from 'node:events';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

import { describeAttachDifferences } from './differences.js';
import { acceptUpgrade, CLOSE_CODES, rejectUpgrade } from './websocket.js';

/**
 * Relay server for the companion extension (issue #102, addendum, mode 2).
 *
 * The user's running, signed-in browser cannot be reached over CDP (Chrome 136
 * and later ignore the debugging switches for the default profile, and
 * restarting it with one would change its command line). Instead, the
 * extension in js/extension, installed once with "Load unpacked", connects
 * from its service worker to this relay on loopback and forwards requests to
 * `chrome.tabs` and `chrome.debugger`. The protocol is documented in
 * js/extension/relay-handler.js.
 *
 * Security: the server listens on a loopback address only; an upgrade whose
 * `Origin` is not `chrome-extension://<id>` (or whose id is not in
 * `allowedExtensionIds`) is refused with HTTP 403, so a web page cannot
 * connect; and only one extension connection is accepted at a time (a second
 * one gets HTTP 409).
 */

/** Relay port the extension connects to unless configured otherwise. */
export const DEFAULT_RELAY_PORT = 9333;

/** Path of the relay's WebSocket endpoint. */
export const RELAY_PATH = '/browser-commander';

/** The unpacked extension to load in chrome://extensions. */
export const EXTENSION_DIRECTORY = fileURLToPath(
  new URL('../../../extension/', import.meta.url)
);

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

const EXTENSION_ORIGIN = /^chrome-extension:\/\/([a-z0-9]+)$/u;

/**
 * The extension id of a `chrome-extension://<id>` origin, or null.
 *
 * @param {string|undefined} origin
 * @returns {string|null}
 */
export function extensionIdFromOrigin(origin) {
  return EXTENSION_ORIGIN.exec(origin ?? '')?.[1] ?? null;
}

/**
 * Decide whether to accept a WebSocket upgrade.
 *
 * @param {Object} request
 * @param {string} request.path - Request path, possibly with a query
 * @param {string} [request.origin] - The Origin header
 * @param {string[]} [request.allowedExtensionIds] - Accept only these ids
 * @param {boolean} [request.connected=false] - An extension is already connected
 * @returns {{accept: true, extensionId: string}|{accept: false, status: number, message: string}}
 */
export function checkRelayUpgrade({
  path,
  origin,
  allowedExtensionIds,
  connected = false,
}) {
  if (new URL(path, 'http://relay').pathname !== RELAY_PATH) {
    return { accept: false, status: 404, message: 'Not found' };
  }
  const extensionId = extensionIdFromOrigin(origin);
  if (!extensionId) {
    return {
      accept: false,
      status: 403,
      message: 'Only the Browser Commander Relay extension may connect',
    };
  }
  if (allowedExtensionIds && !allowedExtensionIds.includes(extensionId)) {
    return {
      accept: false,
      status: 403,
      message: `Extension ${extensionId} is not allowed`,
    };
  }
  if (connected) {
    return {
      accept: false,
      status: 409,
      message: 'Another extension is already connected',
    };
  }
  return { accept: true, extensionId };
}

function assertRelayOptions({ port, host, timeoutMs, allowedExtensionIds }) {
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new TypeError(
      `The relay only listens on loopback (127.0.0.1, ::1 or localhost), got ${host}`
    );
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new TypeError(`port must be an integer 0-65535, got ${port}`);
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError(
      `timeoutMs must be a positive number, got ${timeoutMs}`
    );
  }
  if (
    allowedExtensionIds !== undefined &&
    (!Array.isArray(allowedExtensionIds) ||
      allowedExtensionIds.some((id) => typeof id !== 'string'))
  ) {
    throw new TypeError('allowedExtensionIds must be an array of strings');
  }
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      reject(
        error.code === 'EADDRINUSE'
          ? new Error(
              `The relay port ${host}:${port} is in use; pass another port and set it as "port" in the extension's storage`,
              { cause: error }
            )
          : error
      );
    };
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve(server.address().port);
    });
  });
}

function formatHost(host) {
  return host.includes(':') ? `[${host}]` : host;
}

/** One extension connection and its requests, tabs and events. */
class RelayState {
  constructor() {
    this.connection = null;
    this.extension = null;
    this.nextId = 1;
    this.pending = new Map();
    this.sessions = new Map();
    this.helloWaiters = new Set();
    this.helloTimer = undefined;
  }

  request(method, params = {}) {
    const { connection } = this;
    if (!connection || !this.extension) {
      return Promise.reject(
        new Error('The Browser Commander Relay extension is not connected')
      );
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      connection.send(JSON.stringify({ id, method, params }));
    });
  }

  handleMessage(extensionId, text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (!message || typeof message !== 'object') {
      return;
    }
    if (message.type === 'hello') {
      this.extension = {
        id: extensionId,
        version: String(message.extensionVersion ?? ''),
        userAgent: String(message.userAgent ?? ''),
      };
      for (const waiter of this.helloWaiters) {
        waiter(this.extension);
      }
      this.helloWaiters.clear();
    } else if (message.type === 'event') {
      this.sessions.get(message.tabId)?.emit(message.method, message.params);
    } else if (message.type === 'detached') {
      this.markDetached(message.tabId, message.reason);
    } else if (Number.isInteger(message.id)) {
      this.settle(message);
    }
  }

  settle({ id, result, error }) {
    const entry = this.pending.get(id);
    if (!entry) {
      return;
    }
    this.pending.delete(id);
    if (error) {
      entry.reject(
        new Error(`${entry.method} failed: ${error.message ?? 'unknown error'}`)
      );
    } else {
      entry.resolve(result);
    }
  }

  markDetached(tabId, reason) {
    const emitter = this.sessions.get(tabId);
    if (emitter) {
      this.sessions.delete(tabId);
      emitter.detached = true;
      emitter.emit('detached', { tabId, reason });
    }
  }

  disconnected(reason) {
    this.connection = null;
    this.extension = null;
    for (const entry of this.pending.values()) {
      entry.reject(new Error(`${entry.method} failed: ${reason}`));
    }
    this.pending.clear();
    for (const tabId of [...this.sessions.keys()]) {
      this.markDetached(tabId, reason);
    }
  }
}

function createSession(state, tabId, emitter) {
  const session = {
    tabId,
    /**
     * Send a CDP command to the tab.
     * @param {string} method
     * @param {Object} [params]
     * @returns {Promise<Object>}
     */
    send(method, params = {}) {
      if (emitter.detached) {
        return Promise.reject(
          new Error(`The debugger session of tab ${tabId} is detached`)
        );
      }
      return state.request('cdp.send', { tabId, method, params });
    },
    on(event, listener) {
      emitter.on(event, listener);
      return session;
    },
    once(event, listener) {
      emitter.once(event, listener);
      return session;
    },
    off(event, listener) {
      emitter.off(event, listener);
      return session;
    },
    async detach() {
      if (emitter.detached) {
        return;
      }
      await state.request('debugger.detach', { tabId });
      state.markDetached(tabId, 'detached_by_client');
    },
  };
  return session;
}

function waitForHello(state, timeoutMs, url) {
  return new Promise((resolve, reject) => {
    state.helloTimer = setTimeout(() => {
      state.helloWaiters.delete(resolve);
      reject(
        new Error(
          `No Browser Commander Relay extension connected to ${url} within ${timeoutMs} ms. Install it once from ${EXTENSION_DIRECTORY} with chrome://extensions > Developer mode > "Load unpacked"; it connects to port ${DEFAULT_RELAY_PORT} unless "port" is set in its storage.`
        )
      );
    }, timeoutMs);
    state.helloWaiters.add((extension) => {
      clearTimeout(state.helloTimer);
      resolve(extension);
    });
  });
}

/**
 * Start the relay and wait for the companion extension to connect.
 *
 * @param {Object} [options]
 * @param {number} [options.port=9333] - Loopback port; 0 picks a free one (see `onListening`)
 * @param {string} [options.host='127.0.0.1'] - Loopback address
 * @param {number} [options.timeoutMs=60000] - How long to wait for the extension's hello
 * @param {string[]} [options.allowedExtensionIds] - Accept only these extension ids
 * @param {function({port: number, url: string}): void} [options.onListening] - Called once the server listens, before the extension connects
 * @returns {Promise<{mode: 'extension', extension: {id: string, version: string, userAgent: string}, url: string, port: number, differences: Array<{aspect: string, description: string}>, connected: function(): boolean, tabs: function(): Promise<Array<{tabId: number, url: string, title: string, active: boolean}>>, newTab: function(string=): Promise<{tabId: number}>, session: function(number): Promise<Object>, close: function(): Promise<void>}>}
 */
export async function attachViaExtension({
  port = DEFAULT_RELAY_PORT,
  host = '127.0.0.1',
  timeoutMs = 60_000,
  allowedExtensionIds,
  onListening,
} = {}) {
  assertRelayOptions({ port, host, timeoutMs, allowedExtensionIds });
  const state = new RelayState();
  const sockets = new Set();
  const server = http.createServer((request, response) => {
    response.writeHead(426, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Browser Commander relay: WebSocket only');
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (request, socket, head) => {
    const decision = checkRelayUpgrade({
      path: request.url,
      origin: request.headers.origin,
      allowedExtensionIds,
      connected: state.connection !== null,
    });
    if (!decision.accept) {
      rejectUpgrade(socket, decision.status, decision.message);
      return;
    }
    const connection = acceptUpgrade(request, socket, head);
    if (!connection) {
      return;
    }
    state.connection = connection;
    connection.on('message', (text) =>
      state.handleMessage(decision.extensionId, text)
    );
    connection.on('error', () => {});
    connection.once('close', ({ code }) =>
      state.disconnected(`the extension disconnected (${code})`)
    );
  });

  const actualPort = await listen(server, port, host);
  const url = `ws://${formatHost(host)}:${actualPort}${RELAY_PATH}`;
  let closing;
  const close = () => {
    closing ??= new Promise((resolve) => {
      clearTimeout(state.helloTimer);
      state.connection?.close(CLOSE_CODES.goingAway, 'relay closed');
      state.disconnected('the relay was closed');
      server.close(() => resolve());
      const timer = setTimeout(() => {
        for (const socket of sockets) {
          socket.destroy();
        }
      }, 500);
      timer.unref?.();
    });
    return closing;
  };

  const hello = waitForHello(state, timeoutMs, url);
  try {
    onListening?.({ port: actualPort, url });
    await hello;
  } catch (error) {
    await close();
    throw error;
  }

  const handle = {
    mode: 'extension',
    get extension() {
      return state.extension ? { ...state.extension } : null;
    },
    url,
    port: actualPort,
    differences: describeAttachDifferences('extension'),
    connected: () => state.extension !== null,
    tabs: () => state.request('tabs.list'),
    newTab: (tabUrl) =>
      state.request('tabs.create', tabUrl === undefined ? {} : { url: tabUrl }),
    async session(tabId) {
      if (!Number.isInteger(tabId)) {
        throw new TypeError(`tabId must be an integer, got ${tabId}`);
      }
      await state.request('debugger.attach', { tabId });
      let emitter = state.sessions.get(tabId);
      if (!emitter) {
        emitter = new EventEmitter();
        emitter.detached = false;
        state.sessions.set(tabId, emitter);
      }
      emitter.session ??= createSession(state, tabId, emitter);
      return emitter.session;
    },
    close,
  };
  return handle;
}
