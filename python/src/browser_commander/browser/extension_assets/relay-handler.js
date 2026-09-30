/**
 * The companion extension's side of the Browser Commander relay (issue #102,
 * addendum, mode 2).
 *
 * The extension lets Browser Commander drive tabs of the user's running,
 * already signed-in browser without any debugging switch: its service worker
 * connects to a relay server on loopback and forwards requests to the
 * `chrome.tabs` and `chrome.debugger` APIs. Chrome shows its "started
 * debugging this browser" infobar while a tab is attached, and the user can
 * end the session from there.
 *
 * Protocol (JSON text frames on `ws://127.0.0.1:<port>/browser-commander`):
 *
 * - extension -> server, on open:
 *   `{"type":"hello","extensionVersion":"...","userAgent":"..."}`
 * - server -> extension: `{"id":n,"method":M,"params":{...}}` with M one of
 *   `tabs.list` -> `[{tabId,url,title,active}]`, `tabs.create` {url} ->
 *   `{tabId}`, `debugger.attach` {tabId} -> `{attached:true}`,
 *   `debugger.detach` {tabId} -> `{detached:true}` and `cdp.send`
 *   {tabId,method,params} -> the CDP result
 * - extension -> server: `{"id":n,"result":...}` or
 *   `{"id":n,"error":{"message":"..."}}`
 * - extension -> server, unsolicited:
 *   `{"type":"event","tabId":n,"method":"...","params":{...}}` for CDP events
 *   of attached tabs, `{"type":"detached","tabId":n,"reason":"..."}` when a
 *   debugger session ends, and `{"type":"keepalive"}` every 20 seconds, which
 *   keeps the MV3 service worker alive (Chrome 116+) and is ignored by the
 *   server.
 *
 * This module has no Node or browser imports: `chrome`, `WebSocket` and the
 * timers are passed in, so the tests run it against fakes.
 */

/** Relay port when `chrome.storage.local` has no `port`. */
export const DEFAULT_PORT = 9333;

/** Path of the relay's WebSocket endpoint. */
export const RELAY_PATH = '/browser-commander';

/** chrome.alarms name that wakes the service worker to reconnect. */
export const KEEPALIVE_ALARM = 'browser-commander-relay';

/** chrome.debugger protocol version. */
export const DEBUGGER_PROTOCOL_VERSION = '1.3';

/**
 * The relay URL for a port.
 *
 * @param {number} [port=DEFAULT_PORT]
 * @returns {string}
 */
export function relayUrl(port = DEFAULT_PORT) {
  return `ws://127.0.0.1:${port}${RELAY_PATH}`;
}

function requireTabId(params) {
  if (!Number.isInteger(params.tabId)) {
    throw new Error('params.tabId must be an integer tab id');
  }
  return params.tabId;
}

function describeTab(tab) {
  return {
    tabId: tab.id,
    url: tab.url ?? tab.pendingUrl ?? '',
    title: tab.title ?? '',
    active: Boolean(tab.active),
  };
}

/**
 * Run one relay request against the extension APIs.
 *
 * @param {Object} chrome - The `chrome` namespace (or a fake)
 * @param {{method: string, params: (Object|undefined)}} request
 * @param {Set<number>} attachedTabs - Tabs this extension has attached the debugger to; updated in place
 * @returns {Promise<*>} The `result` of the response
 */
export async function handleRelayRequest(
  chrome,
  { method, params = {} },
  attachedTabs
) {
  switch (method) {
    case 'tabs.list': {
      const tabs = await chrome.tabs.query({});
      return tabs.filter((tab) => Number.isInteger(tab.id)).map(describeTab);
    }
    case 'tabs.create': {
      if (params.url !== undefined && typeof params.url !== 'string') {
        throw new Error('params.url must be a string');
      }
      const tab = await chrome.tabs.create(
        params.url === undefined ? {} : { url: params.url }
      );
      return { tabId: tab.id };
    }
    case 'debugger.attach': {
      const tabId = requireTabId(params);
      if (!attachedTabs.has(tabId)) {
        await chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION);
        attachedTabs.add(tabId);
      }
      return { attached: true };
    }
    case 'debugger.detach': {
      const tabId = requireTabId(params);
      if (attachedTabs.has(tabId)) {
        attachedTabs.delete(tabId);
        await chrome.debugger.detach({ tabId });
      }
      return { detached: true };
    }
    case 'cdp.send': {
      const tabId = requireTabId(params);
      if (typeof params.method !== 'string') {
        throw new Error('params.method must be a CDP method name');
      }
      const result = await chrome.debugger.sendCommand(
        { tabId },
        params.method,
        params.params ?? {}
      );
      return result ?? {};
    }
    default:
      throw new Error(`Unknown relay method: ${method}`);
  }
}

async function readPort(chrome) {
  try {
    const { port } = await chrome.storage.local.get('port');
    const number = Number(port);
    return Number.isInteger(number) && number > 0 && number < 65536
      ? number
      : DEFAULT_PORT;
  } catch {
    return DEFAULT_PORT;
  }
}

/**
 * The service worker's connection to the relay: connects, retries every
 * `retryMs` while the server is down, answers requests, forwards debugger
 * events, and detaches every tab it attached when the connection ends.
 *
 * @param {Object} options
 * @param {Object} options.chrome - The `chrome` namespace
 * @param {Function} options.WebSocket - WebSocket constructor
 * @param {string} [options.userAgent='']
 * @param {number} [options.retryMs=3000]
 * @param {number} [options.keepaliveMs=20000]
 * @param {Function} [options.setTimeout]
 * @param {Function} [options.clearTimeout]
 * @param {Function} [options.setInterval]
 * @param {Function} [options.clearInterval]
 * @returns {{start: function(): void, connect: function(): Promise<void>, stop: function(): void, connected: function(): boolean, attachedTabs: Set<number>}}
 */
export function createRelayClient({
  chrome,
  WebSocket,
  userAgent = '',
  retryMs = 3_000,
  keepaliveMs = 20_000,
  setTimeout: schedule = globalThis.setTimeout,
  clearTimeout: cancel = globalThis.clearTimeout,
  setInterval: repeat = globalThis.setInterval,
  clearInterval: cancelRepeat = globalThis.clearInterval,
}) {
  const attachedTabs = new Set();
  let socket = null;
  let connecting = false;
  let stopped = false;
  let retryTimer = null;
  let keepaliveTimer = null;

  const isOpen = () => socket !== null && socket.readyState === WebSocket.OPEN;

  function post(message) {
    if (isOpen()) {
      socket.send(JSON.stringify(message));
    }
  }

  function scheduleRetry() {
    if (!stopped && retryTimer === null) {
      retryTimer = schedule(() => {
        retryTimer = null;
        connect();
      }, retryMs);
    }
  }

  function detachAll() {
    for (const tabId of [...attachedTabs]) {
      attachedTabs.delete(tabId);
      Promise.resolve()
        .then(() => chrome.debugger.detach({ tabId }))
        .catch(() => {});
    }
  }

  async function respond(message) {
    try {
      const result = await handleRelayRequest(chrome, message, attachedTabs);
      post({ id: message.id, result: result ?? {} });
    } catch (error) {
      post({
        id: message.id,
        error: { message: error?.message ?? String(error) },
      });
    }
  }

  function onMessage(event) {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message && Number.isInteger(message.id) && message.method) {
      respond(message);
    }
  }

  function onOpen(opened) {
    if (socket !== opened) {
      return;
    }
    post({
      type: 'hello',
      extensionVersion: chrome.runtime.getManifest().version,
      userAgent,
    });
    keepaliveTimer = repeat(() => post({ type: 'keepalive' }), keepaliveMs);
  }

  function onClose(closed) {
    if (socket !== closed) {
      return;
    }
    socket = null;
    if (keepaliveTimer !== null) {
      cancelRepeat(keepaliveTimer);
      keepaliveTimer = null;
    }
    detachAll();
    scheduleRetry();
  }

  /** Connect unless a connection is open or being opened. */
  async function connect() {
    if (stopped || connecting || socket !== null) {
      return;
    }
    connecting = true;
    try {
      if (retryTimer !== null) {
        cancel(retryTimer);
        retryTimer = null;
      }
      const port = await readPort(chrome);
      if (stopped) {
        return;
      }
      let opened;
      try {
        opened = new WebSocket(relayUrl(port));
      } catch {
        scheduleRetry();
        return;
      }
      socket = opened;
      opened.onopen = () => onOpen(opened);
      opened.onmessage = onMessage;
      opened.onclose = () => onClose(opened);
      // An error is always followed by close, which schedules the retry.
      opened.onerror = () => {};
    } finally {
      connecting = false;
    }
  }

  function reconnect() {
    const current = socket;
    if (current) {
      current.close();
      onClose(current);
    }
    connect();
  }

  /**
   * Register the listeners and connect. MV3 requires listeners to be added
   * synchronously when the service worker starts, so call this at top level.
   */
  function start() {
    chrome.debugger.onEvent.addListener((source, method, params) => {
      if (attachedTabs.has(source.tabId)) {
        post({ type: 'event', tabId: source.tabId, method, params });
      }
    });
    chrome.debugger.onDetach.addListener((source, reason) => {
      if (attachedTabs.delete(source.tabId)) {
        post({ type: 'detached', tabId: source.tabId, reason });
      }
    });
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === KEEPALIVE_ALARM) {
        connect();
      }
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.port) {
        reconnect();
      }
    });
    chrome.runtime.onStartup.addListener(() => connect());
    chrome.runtime.onInstalled.addListener(() => connect());
    // Wakes a suspended service worker to reconnect; 30 seconds is the
    // shortest period Chrome allows.
    Promise.resolve()
      .then(() =>
        chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 })
      )
      .catch(() => {});
    connect();
  }

  function stop() {
    stopped = true;
    if (retryTimer !== null) {
      cancel(retryTimer);
      retryTimer = null;
    }
    const current = socket;
    if (current) {
      current.close();
      onClose(current);
    }
  }

  return {
    start,
    connect,
    stop,
    connected: isOpen,
    attachedTabs,
  };
}
