/**
 * Parity harness: capture the environment probe from a browser that nothing is
 * automating, then from browsers launched by automation engines, and diff.
 *
 * The reference capture never speaks CDP. Chrome is started as a plain child
 * process pointed at a local page, the page runs the probe and POSTs the JSON
 * report back. That is the only way to get a baseline that is genuinely "a real
 * browser" rather than "a browser we are already driving".
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export function readProbeSource() {
  return readFile(path.join(here, 'probe.js'), 'utf8');
}

/**
 * Read one value out of a probe report by path.
 *
 * The report is JSON POSTed back by a page, so every level of it can be
 * missing: a browser that failed to run half the probe still sends what it
 * got. Walking the path in a loop keeps the runners free of the long
 * `report?.a?.b ?? null` chains that make a flat projection of twenty fields
 * read as a function with a cyclomatic complexity of fifty.
 *
 * @param {unknown} report the parsed probe report, possibly undefined
 * @param {string[]} keyPath property names, outermost first
 * @param {unknown} [fallback] returned when the path is absent
 * @returns {unknown}
 */
export function readReportPath(report, keyPath, fallback = undefined) {
  let value = report;

  for (const key of keyPath) {
    if (value === null || value === undefined) {
      return fallback;
    }

    value = value[key];
  }

  return value === undefined ? fallback : value;
}

/**
 * Project a probe report into the flat, named shape a runner compares on.
 *
 * @param {unknown} report
 * @param {Record<string, string[]>} paths output name to path in the report
 * @param {unknown} [fallback] value for a path the report does not have
 * @returns {Record<string, unknown>}
 */
export function projectReport(report, paths, fallback = undefined) {
  return Object.fromEntries(
    Object.entries(paths).map(([name, keyPath]) => [
      name,
      readReportPath(report, keyPath, fallback),
    ])
  );
}

export function probeExpression(source) {
  return `(${source})()`;
}

/** Serve the probe page and collect reports POSTed back by page scripts. */
export async function startProbeServer(probeSource) {
  const reports = new Map();
  const waiters = new Map();
  // The Accept-Language and Sec-CH-UA-* headers are part of the fingerprint and
  // are only observable from the server side, so record them per token.
  const requestHeaders = new Map();

  const page = (token) => `<!doctype html>
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

  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname.startsWith('/probe/')) {
      const token = url.pathname.slice('/probe/'.length);
      requestHeaders.set(token, { ...request.headers });
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(page(token));
      return;
    }
    if (request.method === 'POST' && url.pathname.startsWith('/report/')) {
      const token = url.pathname.slice('/report/'.length);
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        const report = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        reports.set(token, report);
        const waiter = waiters.get(token);
        if (waiter) {
          waiter(report);
          waiters.delete(token);
        }
        response.writeHead(204);
        response.end();
      });
      return;
    }
    response.writeHead(404);
    response.end();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

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
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/** Start Chrome as an ordinary user would: no CDP, no automation switches. */
export async function captureReferenceReport({
  executablePath = process.env.CHROME_PATH || 'google-chrome',
  server,
  token,
  extraArgs = [],
  headless = false,
}) {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'bc-parity-real-'));
  const args = [
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate',
    ...(headless ? ['--headless=new'] : []),
    ...extraArgs,
    server.url(token),
  ];
  const child = spawn(executablePath, args, {
    stdio: 'ignore',
    detached: true,
  });
  try {
    const report = await server.waitForReport(token);
    return report;
  } finally {
    await killProcessTree(child);
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 10 });
  }
}

/**
 * Chrome forks a zygote, a GPU process and one renderer per tab. Killing only
 * the browser process reparents those children and they keep running, so every
 * capture must take down the whole process group.
 */
export async function killProcessTree(child) {
  const exited = new Promise((resolve) => child.once('exit', resolve));
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
  await exited;
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

/** Deep diff producing dotted paths, so failures name the exact leaked field. */
export function diffReports(reference, candidate, { ignore = [] } = {}) {
  const differences = [];

  const walk = (left, right, trail) => {
    if (isIgnored(trail, ignore)) {
      return;
    }
    const leftIsObject = left && typeof left === 'object';
    const rightIsObject = right && typeof right === 'object';
    if (
      leftIsObject &&
      rightIsObject &&
      !Array.isArray(left) &&
      !Array.isArray(right)
    ) {
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
