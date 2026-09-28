/**
 * Read chrome://version of a browser started with the reference command line.
 *
 * The browser rewrites its own command line: headless mode appends
 * `--ozone-platform=headless`, `--use-angle=swiftshader-webgl`,
 * `--no-first-run` and more, and a Linux build may append
 * `--ozone-platform=x11`. chrome://version shows the rewritten line, so the
 * automated browser's line cannot be compared with the argv a person typed.
 * It is compared with what the same binary shows for that argv instead.
 *
 * A page cannot read chrome://version, so this capture needs a debugger. It
 * uses a fixed `--remote-debugging-port` - which issue #101 measured to change
 * nothing a page observes - and speaks raw CDP over the global WebSocket, so
 * no automation engine is involved.
 */
import { startProcess } from '../utilities/subprocess.js';
import { reserveLoopbackPort } from '../browser/debugging-port.js';
import {
  createTemporaryUserDataDir,
  removeUserDataDir,
} from '../browser/profile-directory.js';

/** Evaluated in chrome://version; returns null until the page has rendered. */
const READ_VERSION_PAGE = `(() => {
  const text = (id) => (document.getElementById(id)?.textContent ?? '').trim();
  if (!text('command_line')) return null;
  return {
    commandLine: text('command_line'),
    version: text('version'),
    executablePath: text('executable_path'),
  };
})()`;

/** Send CDP commands over one page WebSocket. */
function openCdpSocket(url) {
  if (typeof globalThis.WebSocket !== 'function') {
    throw new Error('Reading chrome://version needs Node.js 22.4 or newer');
  }
  const socket = new globalThis.WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      waiter(message);
    }
  });
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  return {
    async send(method, params = {}) {
      await opened;
      const id = nextId++;
      const reply = new Promise((resolve) => pending.set(id, resolve));
      socket.send(JSON.stringify({ id, method, params }));
      const message = await reply;
      if (message.error) {
        throw new Error(`${method}: ${message.error.message}`);
      }
      return message.result;
    },
    close() {
      socket.close();
    },
  };
}

async function openVersionTarget(port, deadline) {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/json/new?chrome://version`,
        { method: 'PUT' }
      );
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // The DevTools HTTP server is not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`no DevTools endpoint on port ${port}`);
}

async function evaluateUntilReady(cdp, deadline) {
  while (Date.now() < deadline) {
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: READ_VERSION_PAGE,
      returnByValue: true,
    });
    if (result?.value) {
      return result.value;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('chrome://version did not render');
}

/**
 * Start `executablePath` with the reference command line plus a fixed
 * debugging port and read chrome://version.
 *
 * @param {Object} options
 * @param {string} options.executablePath
 * @param {boolean} [options.headless=false]
 * @param {number} [options.timeout=30000]
 * @returns {Promise<{commandLine: string, version: string, executablePath: string}>}
 */
export async function readReferenceVersionPage({
  executablePath,
  headless = false,
  timeout = 30_000,
  start = startProcess,
}) {
  const userDataDir = await createTemporaryUserDataDir();
  const port = await reserveLoopbackPort();
  const child = start(
    executablePath,
    [
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${port}`,
      ...(headless ? ['--headless=new'] : []),
      'about:blank',
    ],
    { killGrace: 3000 }
  );
  let cdp;
  try {
    const deadline = Date.now() + timeout;
    const target = await openVersionTarget(port, deadline);
    cdp = openCdpSocket(target.webSocketDebuggerUrl);
    return await evaluateUntilReady(cdp, deadline);
  } finally {
    cdp?.close();
    child.kill('SIGTERM');
    await child.exited;
    await removeUserDataDir(userDataDir);
  }
}
