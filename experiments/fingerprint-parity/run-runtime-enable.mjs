/**
 * Does using the automation engine's own `page.evaluate` make the page
 * observable as debugged?
 *
 * To evaluate JavaScript, Puppeteer and Playwright need an execution context
 * id, and the classic way to get one is `Runtime.enable`. Once the Runtime
 * domain is enabled for a context, every console API call is forwarded to the
 * inspector, which serialises the arguments -- reading `Error.prototype.stack`
 * and the own properties of any object passed. A page can install getters on
 * those and watch them fire. This is the leak rebrowser-patches was written
 * for: https://rebrowser.net/blog/how-to-fix-runtime-enable-cdp-detection-of-
 * puppeteer-playwright-and-other-automation-libraries
 *
 * The baseline experiment never calls `page.evaluate`, so it cannot answer
 * this. Here the page samples the getters continuously and the script marks
 * the moment it calls `page.evaluate`, which separates "the engine is
 * attached" from "the caller asked the engine to run something".
 *
 * Usage:
 *   node experiments/fingerprint-parity/run-runtime-enable.mjs [output.json]
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { killProcessTree } from './harness.mjs';

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const JS_ROOT = process.env.BC_JS_ROOT || path.resolve('js');
const SAMPLE_MS = 150;
const SETTLE_MS = 1200;

const PAGE = (token) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>runtime-enable</title></head>
<body><p id="status">sampling</p>
<script>
(() => {
  const post = (sample) => fetch('/sample/${token}', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sample),
  });
  // The inspector may serialise a console argument on a later task than the
  // call itself, so the flags are cumulative: a read that arrives late is
  // still reported, by the next sample rather than the one that caused it.
  let readStack = false;
  let readElementId = false;
  const sample = () => {
    const error = new Error('probe');
    Object.defineProperty(error, 'stack', {
      configurable: true,
      get() { readStack = true; return ''; },
    });
    console.debug(error);

    const element = document.createElement('div');
    Object.defineProperty(element, 'id', {
      configurable: true,
      get() { readElementId = true; return ''; },
    });
    console.log(element);

    post({ at: Date.now(), readStack, readElementId });
  };
  sample();
  setInterval(sample, ${SAMPLE_MS});
})();
</script></body></html>`;

async function startSampleServer() {
  const samples = new Map();
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname.startsWith('/page/')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(PAGE(url.pathname.slice('/page/'.length)));
      return;
    }
    if (request.method === 'POST' && url.pathname.startsWith('/sample/')) {
      const token = url.pathname.slice('/sample/'.length);
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        const list = samples.get(token) || [];
        list.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        samples.set(token, list);
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
    url: (token) => `http://127.0.0.1:${port}/page/${token}`,
    since(token, at) {
      return (samples.get(token) || []).filter((sample) => sample.at >= at);
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const leaked = (list) =>
  list.some((sample) => sample.readStack || sample.readElementId);

async function withTempDir(prefix, run) {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
  }
}

/** Plain Chrome, nothing attached: the value every scenario is measured against. */
async function captureReference({ server, token }) {
  return withTempDir('bc-runtime-ref-', async (userDataDir) => {
    const child = spawn(
      CHROME,
      [`--user-data-dir=${userDataDir}`, '--no-first-run', server.url(token)],
      { stdio: 'ignore', detached: true }
    );
    try {
      const started = Date.now();
      await wait(SETTLE_MS * 2);
      const samples = server.since(token, started);
      return {
        samples: samples.length,
        leakedBeforeEvaluate: leaked(samples),
        leakedAfterEvaluate: null,
      };
    } finally {
      await killProcessTree(child);
    }
  });
}

async function captureEngine({ server, token, engine }) {
  const { launchBrowser } = await import(
    new URL(`file://${path.resolve(JS_ROOT, 'src/index.js')}`).href
  );
  return withTempDir(`bc-runtime-${engine}-`, async (userDataDir) => {
    const { browser, page } = await launchBrowser({
      engine,
      headless: process.env.PARITY_HEADLESS === 'true',
      slowMo: 0,
      executablePath: CHROME,
      userDataDir,
    });
    try {
      const started = Date.now();
      await page.goto(server.url(token), { waitUntil: 'load' });
      await wait(SETTLE_MS);
      const before = server.since(token, started);

      const evaluatedAt = Date.now();
      await page.evaluate(() => 1 + 1);
      await wait(SETTLE_MS);
      const after = server.since(token, evaluatedAt);

      return {
        samples: before.length + after.length,
        leakedBeforeEvaluate: leaked(before),
        leakedAfterEvaluate: leaked(after),
      };
    } finally {
      await browser.close();
    }
  });
}

/**
 * Positive control: enable the Runtime domain by hand over a raw CDP session.
 *
 * Without this, "no leak" is unfalsifiable -- it could equally mean the
 * detection does not work.
 */
async function captureRuntimeEnabled({ server, token }) {
  const { launchBrowser } = await import(
    new URL(`file://${path.resolve(JS_ROOT, 'src/index.js')}`).href
  );
  return withTempDir('bc-runtime-control-', async (userDataDir) => {
    const { browser, page } = await launchBrowser({
      engine: 'playwright',
      headless: process.env.PARITY_HEADLESS === 'true',
      slowMo: 0,
      executablePath: CHROME,
      userDataDir,
    });
    try {
      const started = Date.now();
      await page.goto(server.url(token), { waitUntil: 'load' });
      await wait(SETTLE_MS);
      const before = server.since(token, started);

      const enabledAt = Date.now();
      const session = await page.context().newCDPSession(page);
      // Counting the events proves the domain is really on. Without that, a
      // negative result could just mean Runtime.enable never took effect.
      let consoleApiEvents = 0;
      session.on('Runtime.consoleAPICalled', () => {
        consoleApiEvents += 1;
      });
      await session.send('Runtime.enable');
      await wait(SETTLE_MS);
      const after = server.since(token, enabledAt);
      await session.detach();

      return {
        samples: before.length + after.length,
        consoleApiEvents,
        leakedBeforeEvaluate: leaked(before),
        leakedAfterEvaluate: leaked(after),
      };
    } finally {
      await browser.close();
    }
  });
}

async function chromeVersion() {
  const { execFile } = await import('node:child_process');
  return new Promise((resolve) => {
    execFile(CHROME, ['--version'], (error, stdout) =>
      resolve(error ? null : stdout.trim())
    );
  });
}

async function main() {
  const server = await startSampleServer();
  const results = { chrome: await chromeVersion() };
  try {
    results.reference = await captureReference({
      server,
      token: 'reference',
    });
    for (const engine of ['playwright', 'puppeteer']) {
      results[engine] = await captureEngine({
        server,
        token: engine,
        engine,
      });
    }
    results.runtimeEnableControl = await captureRuntimeEnabled({
      server,
      token: 'runtime-enable-control',
    });
  } finally {
    await server.close();
  }

  for (const [name, result] of Object.entries(results)) {
    if (name === 'chrome') {
      console.log(`chrome: ${result}`);
      continue;
    }
    const events =
      result.consoleApiEvents === undefined
        ? ''
        : `, consoleAPICalled=${result.consoleApiEvents}`;
    console.log(
      `${name}: ${result.samples} samples, before=${result.leakedBeforeEvaluate}, after=${result.leakedAfterEvaluate}${events}`
    );
  }

  const output = process.argv[2];
  const json = JSON.stringify(results, null, 2);
  if (output) {
    await writeFile(output, `${json}\n`);
    console.log(`wrote ${output}`);
  } else {
    console.log(json);
  }
}

await main();
