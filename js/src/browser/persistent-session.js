import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { connectBrowser, pickForegroundPage } from './connector.js';
import { launchAndConnectRealBrowserWithDependencies } from './real-browser.js';
import { assertDedicatedUserDataDir } from './system-browser.js';
import { startDetachedProcess } from '../utilities/subprocess.js';

export const SESSION_METADATA = '.browser-commander-session.json';
const activity = new WeakMap();
export function touchSessionPage(page) {
  activity.get(page)?.();
}
const read = (file) =>
  fs
    .readFile(file, 'utf8')
    .then(JSON.parse)
    .catch(() => null);
export async function writeSessionMetadata(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
export function probeSession(endpoint) {
  return fetch(`${endpoint}/json/version`, {
    signal: AbortSignal.timeout(1000),
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
}
export async function acquireLease(file, retries = 50) {
  let lease;
  try {
    lease = await fs.open(file, 'wx', 0o600);
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
    const owner = await read(file);
    if (retries > 0) {
      let alive = !owner?.pid;
      if (owner?.pid) {
        try {
          process.kill(owner.pid, 0);
          alive = true;
        } catch (error) {
          alive = error.code !== 'ESRCH';
        }
      }
      if (alive) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return acquireLease(file, retries - 1);
      }
    }
    if (!owner?.pid) {
      throw new Error('Persistent session launch is already in progress', {
        cause: error,
      });
    }
    let alive = true;
    try {
      process.kill(owner.pid, 0);
    } catch (error) {
      alive = error.code !== 'ESRCH';
    }
    if (alive) {
      throw new Error('Persistent session launch is already in progress', {
        cause: error,
      });
    }
    await fs.rm(file);
    lease = await fs.open(file, 'wx', 0o600);
  }
  const token = randomUUID();
  await lease.writeFile(JSON.stringify({ pid: process.pid, token }));
  return async () => {
    await lease.close();
    if ((await read(file))?.token === token) {
      await fs.rm(file, { force: true });
    }
  };
}
function validate(options) {
  if (
    !options.userDataDir ||
    !Number.isInteger(options.remoteDebuggingPort) ||
    options.remoteDebuggingPort < 1 ||
    options.remoteDebuggingPort > 65535
  ) {
    throw new TypeError(
      'connectOrLaunch requires a dedicated userDataDir and fixed remoteDebuggingPort'
    );
  }
  if (!Number.isFinite(options.idleTimeoutMs) || options.idleTimeoutMs <= 0) {
    throw new RangeError('idleTimeoutMs must be positive');
  }
  if (!['playwright', 'puppeteer'].includes(options.engine)) {
    throw new TypeError('Persistent sessions require a Chromium CDP engine');
  }
  assertDedicatedUserDataDir(options.userDataDir);
}
async function open(options, file, endpoint) {
  let metadata = await read(file);
  const version = await probeSession(endpoint);
  if (version) {
    if (
      !metadata ||
      metadata.remoteDebuggingPort !== options.remoteDebuggingPort ||
      metadata.webSocketDebuggerUrl !== version.webSocketDebuggerUrl
    ) {
      throw new Error('Debugging port belongs to another browser/profile');
    }
    const session = await connectBrowser({
      ...options,
      cdpEndpoint: endpoint,
      targetId:
        options.targetId ?? (!options.url ? metadata.targetId : undefined),
    });
    return { session, metadata, reused: true };
  }
  const session = await launchAndConnectRealBrowserWithDependencies(
    { ...options, keepOpen: false },
    {
      spawnBrowser: (file, args, settings) =>
        startDetachedProcess(file, args, settings),
    }
  );
  try {
    const version = await probeSession(endpoint);
    if (!version) {
      throw new Error('Persistent browser endpoint disappeared after launch');
    }
    metadata = {
      token: randomUUID(),
      pid: session.browserProcess.pid,
      userDataDir: path.resolve(options.userDataDir),
      remoteDebuggingPort: options.remoteDebuggingPort,
      webSocketDebuggerUrl: version.webSocketDebuggerUrl,
    };
    return { session, metadata, reused: false };
  } catch (error) {
    await session.close();
    throw error;
  }
}
async function remember(page, engine, file, metadata, idleTimeoutMs) {
  const cdp =
    engine === 'playwright'
      ? await page.context().newCDPSession(page)
      : await page.target().createCDPSession();
  try {
    metadata.targetId = (
      await cdp.send('Target.getTargetInfo')
    ).targetInfo.targetId;
  } finally {
    await cdp.detach();
  }
  metadata.lastActive = Date.now();
  metadata.idleTimeoutMs = idleTimeoutMs;
  await writeSessionMetadata(file, metadata);
}
export async function closeOwnedSession(file, metadata) {
  if ((await read(file))?.token !== metadata.token) {
    return;
  }
  const version = await probeSession(
    `http://127.0.0.1:${metadata.remoteDebuggingPort}`
  );
  if (version?.webSocketDebuggerUrl === metadata.webSocketDebuggerUrl) {
    await closeRemoteBrowser(version.webSocketDebuggerUrl);
  }
  await fs.rm(file, { force: true });
}
async function lifecycle(
  { session, metadata, reused },
  options,
  file,
  endpoint
) {
  const { engine, idleTimeoutMs } = options;
  let page = session.page,
    disconnected = false,
    closed = false,
    activityQueue = Promise.resolve();
  const touch = () => {
    activityQueue = activityQueue
      .then(async () => {
        const release = await acquireLease(`${file}.lock`);
        try {
          const current = await read(file);
          if (current?.token === metadata.token) {
            current.lastActive = Date.now();
            await writeSessionMetadata(file, current);
          }
        } finally {
          await release();
        }
      })
      .catch(() => {});
  };
  const bind = (value) => {
    activity.set(value, touch);
    value.on?.('framenavigated', touch);
  };
  const unbind = (value) => {
    activity.delete(value);
    value.off?.('framenavigated', touch);
  };
  await remember(page, engine, file, metadata, idleTimeoutMs);
  bind(page);
  const detach = async () => {
    if (disconnected) {
      return;
    }
    touch();
    await activityQueue;
    unbind(page);
    disconnected = true;
    try {
      await session.downloads?.dispose();
    } finally {
      await session.detach();
    }
  };
  const close = async () => {
    if (closed) {
      return;
    }
    if (!disconnected) {
      await detach().catch(() => {});
    }
    const release = await acquireLease(`${file}.lock`);
    try {
      await closeOwnedSession(file, metadata);
    } finally {
      await release();
    }
    closed = true;
  };
  const result = {
    ...session,
    detach,
    close,
    touch,
    reused,
    cdpEndpoint: endpoint,
    userDataDir: path.resolve(options.userDataDir),
    remoteDebuggingPort: options.remoteDebuggingPort,
    temporaryProfile: false,
  };
  result.reusePage = async (selection = {}) => {
    if (disconnected) {
      throw new Error('Persistent controller is detached');
    }
    const release = await acquireLease(`${file}.lock`);
    try {
      const current = await read(file);
      if (current?.token !== metadata.token) {
        throw new Error('Persistent session ownership changed');
      }
      const pages =
        engine === 'playwright'
          ? page.context().pages()
          : await session.browser.pages();
      const selected = await pickForegroundPage(pages, {
        targetId:
          selection.targetId ??
          (!selection.url ? metadata.targetId : undefined),
        ...selection,
      });
      if (!selected) {
        throw new Error('No reusable browser page');
      }
      unbind(page);
      page = selected;
      bind(page);
      result.page = page;
      await remember(page, engine, file, metadata, idleTimeoutMs);
    } finally {
      await release();
    }
    return page;
  };
  if (!reused) {
    await startDetachedProcess(process.execPath, [
      fileURLToPath(new URL('./session-watchdog.js', import.meta.url)),
      file,
      metadata.token,
    ]);
  }
  return result;
}
export async function closeRemoteBrowser(endpoint) {
  await new Promise((resolve, reject) => {
    const socket = new globalThis.WebSocket(endpoint);
    let acknowledged = false;
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('Browser.close timed out'));
    }, 3000);
    socket.onopen = () =>
      socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    socket.onclose = () => {
      clearTimeout(timer);
      resolve();
    };
    socket.onerror = () => {
      // Chrome can close the TCP connection without a WebSocket close frame
      // after acknowledging Browser.close. Its ensuing close event completes
      // shutdown; a pre-acknowledgement connection error remains a failure.
      if (!acknowledged) {
        clearTimeout(timer);
        reject(new Error('Browser.close connection failed'));
      }
    };
    socket.onmessage = ({ data }) => {
      const response = JSON.parse(data);
      if (response.id !== 1) {
        return;
      }
      if (response.error) {
        clearTimeout(timer);
        reject(new Error(response.error.message ?? 'Browser.close failed'));
        socket.close();
      } else {
        acknowledged = true;
      }
    };
  });
}
/** Reuse an owned profile/port; detach survives the controller; close terminates it. */
export async function connectOrLaunch(settings = {}) {
  const options = {
    engine: 'playwright',
    idleTimeoutMs: 30 * 60 * 1000,
    ...settings,
  };
  validate(options);
  await fs.mkdir(options.userDataDir, { recursive: true, mode: 0o700 });
  const file = path.join(path.resolve(options.userDataDir), SESSION_METADATA);
  const release = await acquireLease(`${file}.lock`);
  const endpoint = `http://127.0.0.1:${options.remoteDebuggingPort}`;
  let owned;
  try {
    owned = await open(options, file, endpoint);
    return await lifecycle(owned, options, file, endpoint);
  } catch (error) {
    if (owned && !owned.reused) {
      await owned.session.close().catch(() => {});
    }
    throw error;
  } finally {
    await release();
  }
}
