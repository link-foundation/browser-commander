/**
 * Parity harness: capture the environment probe from a browser that nothing is
 * automating, then from a browser Browser Commander drives, and diff the two.
 *
 * The reference capture never speaks CDP. The browser is started as a plain
 * child process pointed at a local page; the page runs the probe and POSTs the
 * JSON report back. That is the only way to get a baseline that is genuinely
 * "a real browser" rather than "a browser we are already driving". Automated
 * captures are delivered the same way, so a difference in the diff is a
 * difference in the browser rather than in how the probe was invoked.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

import { startProcess } from '../utilities/subprocess.js';
import {
  createTemporaryUserDataDir,
  removeUserDataDir,
} from '../browser/profile-directory.js';

/** Read the environment probe shipped with the package. */
export function readProbeSource() {
  return readFile(new URL('./probe.js', import.meta.url), 'utf8');
}

export function probeExpression(source) {
  return `(${source})()`;
}

function probePage(probeSource, token) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>probe</title></head>
<body><p id="status">running</p>
<script>
${probeExpression(probeSource)}
  .then((report) => fetch('/report/${token}', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(report),
  }))
  .then(() => { document.getElementById('status').textContent = 'done'; })
  .catch((error) => fetch('/report/${token}', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fatal: String(error && error.stack || error) }),
  }));
</script></body></html>`;
}

/** Serve the probe page and collect reports POSTed back by page scripts. */
export async function startProbeServer(probeSource) {
  const reports = new Map();
  const waiters = new Map();
  // The Accept-Language and Sec-CH-UA-* headers are part of the fingerprint and
  // are only observable from the server side, so record them per token.
  const requestHeaders = new Map();

  const receiveReport = (token, request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const report = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      reports.set(token, report);
      waiters.get(token)?.(report);
      waiters.delete(token);
      response.writeHead(204);
      response.end();
    });
  };

  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname.startsWith('/probe/')) {
      const token = url.pathname.slice('/probe/'.length);
      requestHeaders.set(token, { ...request.headers });
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(probePage(probeSource, token));
      return;
    }
    if (request.method === 'POST' && url.pathname.startsWith('/report/')) {
      receiveReport(url.pathname.slice('/report/'.length), request, response);
      return;
    }
    response.writeHead(404);
    response.end();
  });

  const port = await new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  );

  return {
    port,
    url: (token) => `http://127.0.0.1:${port}/probe/${token}`,
    headersFor: (token) => requestHeaders.get(token) || null,
    waitForReport(token, timeoutMs = 60000) {
      if (reports.has(token)) {
        return Promise.resolve(reports.get(token));
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`timed out waiting for report ${token}`)),
          timeoutMs
        );
        waiters.set(token, (report) => {
          clearTimeout(timer);
          resolve(report);
        });
      });
    },
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/**
 * The command line of a hand-started reference browser: a dedicated profile,
 * headless when asked, and the page to open. Nothing else, so the reference is
 * exactly what a person types.
 *
 * @param {Object} options
 * @param {string} options.userDataDir
 * @param {string} options.url
 * @param {boolean} [options.headless=false]
 * @param {string[]} [options.extraArgs]
 * @returns {string[]}
 */
export function buildReferenceArgs({
  userDataDir,
  url,
  headless = false,
  extraArgs = [],
}) {
  return [
    `--user-data-dir=${userDataDir}`,
    ...(headless ? ['--headless=new'] : []),
    ...extraArgs,
    url,
  ];
}

const STDERR_TAIL_BYTES = 4000;

/** Keep the last few kilobytes a process wrote, for error messages. */
function collectTail(channel) {
  let tail = '';
  channel?.on?.('data', (chunk) => {
    tail = (tail + String(chunk)).slice(-STDERR_TAIL_BYTES);
  });
  return () => tail.trim();
}

function withOutput(error, output) {
  if (output) {
    error.message += `\nbrowser stderr:\n${output}`;
  }
  return error;
}

/**
 * Reject as soon as the reference browser exits without having reported, so a
 * browser that cannot start (a missing sandbox, a bad switch) fails with its
 * own exit code and stderr instead of a silent report timeout. A clean exit
 * never settles: a launcher script may hand off to a browser that keeps
 * running and still reports.
 */
async function exitedBeforeReport(child, executablePath, stderr) {
  const code = await child.exited;
  if (code === 0) {
    return new Promise(() => {});
  }
  throw withOutput(
    new Error(
      `reference browser ${executablePath} exited with code ${code} before reporting`
    ),
    stderr()
  );
}

/**
 * Start the browser as an ordinary user would - no CDP, no automation
 * switches - and collect the probe report its page POSTs back.
 *
 * The profile is prepared exactly like the launcher's temporary profile: the
 * `First Run` sentinel and the "What's new" milestone in `Local State` keep
 * the first-run UI and a second tab from opening.
 *
 * @returns {Promise<Object>} The probe report with `commandLine` attached
 */
async function captureReferenceAttempt({
  executablePath = process.env.CHROME_PATH || 'google-chrome',
  server,
  token,
  extraArgs = [],
  headless = false,
  timeoutMs = 60000,
  start = startProcess,
}) {
  const userDataDir = await createTemporaryUserDataDir();
  const args = buildReferenceArgs({
    userDataDir,
    url: server.url(token),
    headless,
    extraArgs,
  });
  const child = start(executablePath, args, { killGrace: 3000 });
  const stderr = collectTail(child.stderr);
  try {
    const report = await Promise.race([
      server.waitForReport(token, timeoutMs).catch((error) => {
        throw withOutput(error, stderr());
      }),
      exitedBeforeReport(child, executablePath, stderr),
    ]);
    Object.defineProperty(report, 'commandLine', {
      value: args,
      enumerable: false,
    });
    return report;
  } finally {
    child.kill('SIGTERM');
    await child.exited;
    await removeUserDataDir(userDataDir);
  }
}

/**
 * Edge can keep running after its network service crashes during startup,
 * leaving the probe page unable to POST. Retry only that observed transient
 * startup failure; a separate profile and token keep late first-attempt
 * reports from being mistaken for the retry's report.
 */
export async function captureReferenceReport(options) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await captureReferenceAttempt({
        ...options,
        token:
          attempt === 0 ? options.token : `${options.token}-retry-${attempt}`,
      });
    } catch (error) {
      if (
        attempt === 0 &&
        error.message.startsWith('timed out waiting for report ') &&
        error.message.includes(
          'Network service crashed or was terminated, restarting service.'
        )
      ) {
        continue;
      }
      throw error;
    }
  }
}

const IGNORED_PATHS = [
  // Window geometry depends on the window manager and on how each engine sizes
  // the first window; it is user-configurable, not an automation artifact.
  /^window\.(innerWidth|innerHeight|outerWidth|outerHeight|screenX|screenY|screenLeft|screenTop)$/u,
  /^viewportRelation\./u,
  /^document\.(referrer|hasFocus|bodyClientHeightIsPositive)$/u,
  /^probeErrors\./u,
  // NetworkInformation.downlink is a rolling bandwidth estimate: two captures
  // from the same real browser disagree, so it carries no automation signal.
  /^connection\.(downlink|rtt)$/u,
];

function isIgnored(pathString, extraIgnores) {
  return (
    IGNORED_PATHS.some((pattern) => pattern.test(pathString)) ||
    extraIgnores.some((pattern) => pattern.test(pathString))
  );
}

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Deep diff producing dotted paths, so failures name the exact leaked field. */
export function diffReports(reference, candidate, { ignore = [] } = {}) {
  const differences = [];

  const walk = (left, right, trail) => {
    if (isIgnored(trail, ignore)) {
      return;
    }
    if (isPlainRecord(left) && isPlainRecord(right)) {
      const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
      for (const key of [...keys].sort()) {
        walk(left[key], right[key], trail ? `${trail}.${key}` : key);
      }
      return;
    }
    if (JSON.stringify(left) !== JSON.stringify(right)) {
      differences.push({ path: trail, reference: left, candidate: right });
    }
  };

  walk(reference, candidate, '');
  return differences;
}
