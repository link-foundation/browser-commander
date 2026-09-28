import net from 'node:net';

/**
 * A fixed, non-zero `--remote-debugging-port` is the only CDP transport that
 * leaves `navigator.webdriver` false without the unsupported
 * `--disable-blink-features=AutomationControlled` switch: Chromium's
 * `content/child/runtime_features.cc` treats `--remote-debugging-pipe` and
 * `--remote-debugging-port=0` as automation, but a specific port as a human
 * attaching a debugger (issue #101).
 *
 * The port is reserved by binding `127.0.0.1:0`, reading the port the kernel
 * picked and closing the socket. Another process can take the port between
 * that close and Chrome's bind, so the launcher confirms ownership and retries.
 *
 * Chrome only writes `DevToolsActivePort` into the profile for port 0 (see
 * `chrome/browser/devtools/remote_debugging_server.cc`), so for a fixed port
 * ownership is confirmed from the line Chromium prints to stderr when its
 * DevTools server starts:
 *
 *     DevTools listening on ws://127.0.0.1:<port>/devtools/browser/<id>
 *
 * When the loopback port is taken Chromium logs `bind() failed: Address
 * already in use` and falls back to `[::1]:<port>` (measured with Chrome 153,
 * experiments/issue-105/port-race.mjs); when both fail it logs `Cannot start
 * http server for devtools`. Either outcome is reported as a race.
 */

export const LOOPBACK_HOST = '127.0.0.1';

/** Thrown when the reserved port was taken before the browser could bind it. */
export class PortRaceError extends Error {
  constructor(port, detail) {
    super(
      `Remote debugging port ${port} was taken by another process before the browser bound it${detail ? ` (${detail})` : ''}`
    );
    this.name = 'PortRaceError';
    this.port = port;
  }
}

/**
 * Reserve a free loopback TCP port for `--remote-debugging-port`.
 *
 * @param {Object} [options]
 * @param {string} [options.host='127.0.0.1'] - Interface to bind while reserving
 * @returns {Promise<number>} A port that was free a moment ago
 */
export async function reserveLoopbackPort({ host = LOOPBACK_HOST } = {}) {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ port: 0, host, exclusive: true }, () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

/** Validate a caller-supplied debugging port; zero is refused on purpose. */
export function assertFixedDebuggingPort(port) {
  if (port === 0) {
    throw new RangeError(
      'remoteDebuggingPort 0 makes Chrome enable AutomationControlled (navigator.webdriver === true); omit it so a free fixed port is reserved'
    );
  }
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new RangeError(
      'remoteDebuggingPort must be an integer from 1 to 65535'
    );
  }
  return port;
}

const LISTENING_PATTERN =
  /DevTools listening on (ws:\/\/(\[[^\]]+\]|[^:/\s]+):(\d+)\/devtools\/browser\/[^\s]+)/;
// A bare `bind() failed` can come from unrelated sockets (media router, mDNS),
// so only DevTools' own give-up message counts as a failure on its own.
const BIND_FAILURE_PATTERN = /Cannot start http server for devtools/i;

/**
 * Parse Chromium's DevTools startup output.
 *
 * @param {string} text - Browser stderr collected so far
 * @returns {{listening: {url: string, host: string, port: number}|null, bindFailed: boolean}}
 */
export function parseDevToolsOutput(text) {
  const match = LISTENING_PATTERN.exec(text);
  return {
    listening: match
      ? {
          url: match[1],
          host: match[2].replace(/^\[|\]$/g, ''),
          port: Number(match[3]),
        }
      : null,
    bindFailed: BIND_FAILURE_PATTERN.test(text),
  };
}

/**
 * Collect a browser's stderr so the launcher can confirm which process owns
 * the debugging port. The stream keeps being drained after startup so a
 * chatty browser never blocks on a full pipe.
 *
 * @param {import('node:stream').Readable|null|undefined} stream - Browser stderr
 * @param {Object} [options]
 * @param {boolean} [options.forward=false] - Also copy the output to process.stderr
 * @returns {{available: boolean, state: () => ReturnType<typeof parseDevToolsOutput>}}
 */
export function watchDevToolsOutput(stream, { forward = false } = {}) {
  if (!stream || typeof stream.on !== 'function') {
    return {
      available: false,
      state: () => ({ listening: null, bindFailed: false }),
    };
  }
  let text = '';
  let settled = null;
  stream.on('data', (chunk) => {
    if (forward) {
      process.stderr.write(chunk);
    }
    if (settled) {
      return;
    }
    // Only the startup lines matter; cap the buffer so it cannot grow forever.
    text = `${text}${chunk}`.slice(-65_536);
    const parsed = parseDevToolsOutput(text);
    if (parsed.listening) {
      settled = parsed;
    }
  });
  return {
    available: true,
    state: () => settled ?? parseDevToolsOutput(text),
  };
}

/**
 * Decide whether the DevTools output proves that `port` belongs to our
 * browser, proves a race, or is not conclusive yet.
 *
 * @returns {'owned'|'race'|'pending'}
 */
export function classifyDevToolsOwnership(output, port) {
  const { listening, bindFailed } = output;
  if (listening) {
    if (listening.port === port && listening.host === LOOPBACK_HOST) {
      return 'owned';
    }
    return 'race';
  }
  return bindFailed ? 'race' : 'pending';
}
