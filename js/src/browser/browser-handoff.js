/**
 * Hand a launched browser from one controller to the next (issue #174).
 *
 * An embedding supervisor that keeps a human-facing browser open across its
 * own restarts needs three things from a launch:
 *
 * - interruption ownership: `launchBrowser({ interruption: 'caller' })`
 *   leaves Ctrl+C to the supervisor's own SIGINT handler (see
 *   `startProcess` in `utilities/subprocess.js`);
 * - a `detach()` that stops this controller without touching the browser and
 *   returns a JSON-serializable {@link BrowserHandoff} naming the exact
 *   browser instance and tab;
 * - {@link reconnectBrowser}, which attaches to that exact tab again - it
 *   never launches a browser and never creates or navigates a page, so a page
 *   waiting for a human (a login, a captcha) is found exactly as it was left.
 *
 * Whoever holds the hand-off owns the browser: `close()` on the launch result
 * or on a reconnected session closes the browser, waits for the actual
 * process to exit, and removes a temporary profile.
 */

import { readFileSync } from 'node:fs';
import { connectBrowser } from './connector.js';
import { removeUserDataDir } from './profile-directory.js';
import { closeRemoteBrowser, probeSession } from './cdp-browser-endpoint.js';
import { signalProcessTree } from '../utilities/subprocess.js';
import { withDeadline } from '../traces/deadline.js';

/** Version of the {@link BrowserHandoff} shape. */
export const BROWSER_HANDOFF_VERSION = 1;

/**
 * @typedef {Object} BrowserHandoff
 * @property {number} version - {@link BROWSER_HANDOFF_VERSION}
 * @property {'playwright'|'puppeteer'|'selenium'} engine - Engine of the controller that handed off
 * @property {string} cdpEndpoint - HTTP DevTools endpoint, such as http://127.0.0.1:9222
 * @property {string} webSocketDebuggerUrl - Identity of the exact browser instance
 * @property {string} targetId - DevTools target id of the exact tab
 * @property {number|null} pid - Browser process id
 * @property {string|null} userDataDir - Profile directory
 * @property {boolean} temporaryProfile - Whether close() removes the profile
 * @property {number|null} remoteDebuggingPort - Loopback CDP port
 * @property {string|null} executablePath - Browser executable
 */

/** Raised when a hand-off no longer names a running browser or tab. */
export class BrowserHandoffError extends Error {
  constructor(message, { cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'BrowserHandoffError';
  }
}

/** DevTools target id of an engine page: the exact tab, across controllers. */
export async function pageTargetId({ engine, page, browser }) {
  if (engine === 'selenium') {
    // ChromeDriver window handles are target ids (older builds prefix them).
    const handle = await browser.getWindowHandle();
    return String(handle).replace(/^CDwindow-/, '');
  }
  const cdp =
    engine === 'playwright'
      ? await page.context().newCDPSession(page)
      : await page.target().createCDPSession();
  try {
    return (await cdp.send('Target.getTargetInfo')).targetInfo.targetId;
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/** Describe the browser and tab a controller holds, for another controller. */
async function describe(owner, page) {
  const version = await probeSession(owner.cdpEndpoint);
  if (!version?.webSocketDebuggerUrl) {
    throw new BrowserHandoffError(
      `No browser answers at ${owner.cdpEndpoint}; nothing to hand off`
    );
  }
  return {
    version: BROWSER_HANDOFF_VERSION,
    engine: owner.engine,
    cdpEndpoint: owner.cdpEndpoint,
    webSocketDebuggerUrl: version.webSocketDebuggerUrl,
    targetId: await pageTargetId({
      engine: owner.engine,
      page,
      browser: owner.connectedBrowser(),
    }),
    pid: owner.pid() ?? null,
    userDataDir: owner.userDataDir ?? null,
    temporaryProfile: Boolean(owner.temporaryProfile),
    remoteDebuggingPort: owner.remoteDebuggingPort ?? null,
    executablePath: owner.executablePath ?? null,
  };
}

/**
 * Add `handoff()` and a hand-off returning `detach()` to a session.
 *
 * `state` is shared with the session's closer so that `close()` after
 * `detach()` closes the browser over its WebSocket instead of the dropped
 * engine connection.
 */
export function installHandoff(session, owner, state) {
  const engineDetach = session.detach;
  let detaching;
  // Read by session persistence; not enumerable, so a launch result that
  // spreads the session does not copy a value that goes stale.
  Object.defineProperty(session, 'detached', {
    configurable: true,
    get: () => Boolean(state.detached),
  });
  session.handoff = async ({ page } = {}) => {
    if (state.detached) {
      return state.handoff;
    }
    return await describe(owner, page ?? session.page);
  };
  session.detach = ({ page } = {}) => {
    detaching ??= (async () => {
      const handoff = await session.handoff({ page });
      state.handoff = handoff;
      state.webSocketDebuggerUrl = handoff.webSocketDebuggerUrl;
      state.detached = true;
      await engineDetach?.();
      owner.release?.();
      return handoff;
    })();
    return detaching;
  };
  return session;
}

function readHandoff(handoff) {
  let value = handoff;
  if (typeof value === 'string') {
    value = JSON.parse(
      value.trimStart().startsWith('{') ? value : readFileSync(value, 'utf8')
    );
  }
  for (const field of ['cdpEndpoint', 'webSocketDebuggerUrl', 'targetId']) {
    if (typeof value?.[field] !== 'string' || !value[field]) {
      throw new TypeError(`Browser hand-off is missing ${field}`);
    }
  }
  if (value.version !== BROWSER_HANDOFF_VERSION) {
    throw new TypeError(
      `Unsupported browser hand-off version ${String(value.version)}`
    );
  }
  return value;
}

function processRunning(pid) {
  try {
    process.kill(pid, 0);
  } catch (error) {
    return error.code === 'EPERM';
  }
  if (process.platform === 'linux') {
    // A zombie still answers signal 0; its parent has not reaped it yet.
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      return stat.slice(stat.lastIndexOf(')') + 2)[0] !== 'Z';
    } catch {
      return false;
    }
  }
  return true;
}

/** Wait until a process that is not necessarily our child has exited. */
export async function waitForPidExit(pid, timeout) {
  const deadline = Date.now() + timeout;
  while (processRunning(pid)) {
    if (Date.now() >= deadline) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return true;
}

/**
 * Close a handed-off browser and wait for its process to exit: `Browser.close`
 * first, SIGKILL to its process group if it is still running after
 * `closeTimeout`, then remove a temporary profile.
 */
export async function closeHandedOffBrowser(handoff, { closeTimeout = 5000 }) {
  const version = await probeSession(handoff.cdpEndpoint);
  if (version?.webSocketDebuggerUrl === handoff.webSocketDebuggerUrl) {
    await withDeadline(
      closeRemoteBrowser(handoff.webSocketDebuggerUrl),
      closeTimeout,
      'browser close'
    ).catch(() => {});
  }
  if (handoff.pid && !(await waitForPidExit(handoff.pid, closeTimeout))) {
    signalProcessTree(handoff.pid, 'SIGKILL');
    await waitForPidExit(handoff.pid, closeTimeout);
  }
  if (handoff.temporaryProfile && handoff.userDataDir) {
    await removeUserDataDir(handoff.userDataDir);
  }
}

/**
 * Attach a new controller to the exact browser and tab a previous controller
 * handed off with `detach()`.
 *
 * The endpoint must still belong to the same browser instance (its
 * `webSocketDebuggerUrl` is compared) and the tab must still exist; otherwise
 * this throws instead of launching a browser or opening a page. The result
 * owns the browser like the launch did: `close()` closes it and waits for its
 * process to exit, `detach()` hands it off again.
 *
 * @param {BrowserHandoff|string} handoff - The hand-off object, its JSON, or a path to a JSON file
 * @param {Object} [options] - {@link connectBrowser} options; `engine` defaults to the hand-off's
 * @param {number} [options.closeTimeout=5000] - How long close() waits before killing the process
 * @returns {Promise<Object>} {@link connectBrowser} handles plus `close`, `detach`, `handoff`, `pid`, `cdpEndpoint`, `userDataDir`, `temporaryProfile`
 */
export async function reconnectBrowser(handoff, options = {}) {
  return await reconnectBrowserWithDependencies(handoff, options);
}

export async function reconnectBrowserWithDependencies(
  handoff,
  options = {},
  dependencies = {}
) {
  const descriptor = readHandoff(handoff);
  const { closeTimeout = 5000, ...connectionOptions } = options;
  const engine = options.engine ?? descriptor.engine ?? 'playwright';
  const version = await probeSession(descriptor.cdpEndpoint);
  if (version?.webSocketDebuggerUrl !== descriptor.webSocketDebuggerUrl) {
    throw new BrowserHandoffError(
      version
        ? `${descriptor.cdpEndpoint} now belongs to another browser instance`
        : `The handed-off browser no longer answers at ${descriptor.cdpEndpoint}`
    );
  }
  const connect = dependencies.connect ?? connectBrowser;
  let connection;
  try {
    connection = await connect({
      ...connectionOptions,
      engine,
      cdpEndpoint: descriptor.cdpEndpoint,
      targetId: descriptor.targetId,
      fallback: false,
    });
  } catch (error) {
    throw new BrowserHandoffError(
      `Could not reattach to tab ${descriptor.targetId}: ${error.message}`,
      { cause: error }
    );
  }
  const state = { detached: false };
  const owner = {
    ...descriptor,
    engine,
    pid: () => descriptor.pid,
    connectedBrowser: () => connection.browser,
  };
  const originalClose = connection.browser?.close;
  let closing;
  const close = () => {
    closing ??= (async () => {
      if (!state.detached) {
        await connection.downloads?.dispose?.().catch(() => {});
        if (engine === 'selenium') {
          await connection.detach?.().catch(() => {});
        }
      }
      await closeHandedOffBrowser(descriptor, { closeTimeout });
      if (engine !== 'selenium') {
        await Promise.resolve()
          .then(() => originalClose?.call(connection.browser))
          .catch(() => {});
      }
    })();
    return closing;
  };
  if (connection.browser && engine !== 'selenium') {
    // As for a launch, browser.close() closes the browser this session owns.
    connection.browser.close = close;
  }
  const session = installHandoff(
    {
      ...connection,
      close,
      pid: descriptor.pid,
      cdpEndpoint: descriptor.cdpEndpoint,
      remoteDebuggingPort: descriptor.remoteDebuggingPort,
      userDataDir: descriptor.userDataDir,
      temporaryProfile: descriptor.temporaryProfile,
      executablePath: descriptor.executablePath,
    },
    owner,
    state
  );
  return session;
}
