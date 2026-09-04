/**
 * Baseline experiment: what does browser-commander leak today?
 *
 * Every capture uses the same delivery path -- the browser navigates to the
 * probe page and the page POSTs its report back -- so a difference in the diff
 * is a difference in the browser, not in how the probe was invoked.
 *
 * Usage:
 *   node experiments/fingerprint-parity/run-baseline.mjs [output.json]
 *   PARITY_HEADLESS=true node experiments/fingerprint-parity/run-baseline.mjs
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  captureReferenceReport,
  diffReports,
  killProcessTree,
  readProbeSource,
  startProbeServer,
} from './harness.mjs';

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const HEADLESS = process.env.PARITY_HEADLESS === 'true';

// Engines live in js/node_modules; this script sits outside that package root.
const engineRequire = createRequire(
  `${process.env.BC_JS_ROOT || path.resolve('js')}/package.json`
);
const importEngine = async (name) => {
  const loaded = await import(
    new URL(`file://${engineRequire.resolve(name)}`).href
  );
  return loaded.default && !loaded.chromium && !loaded.launch
    ? loaded.default
    : loaded;
};

const LIBRARY_ARGS = [
  '--disable-session-crashed-bubble',
  '--hide-crash-restore-bubble',
  '--disable-infobars',
  '--password-store=basic',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-crash-restore',
];

// content/child/runtime_features.cc maps --enable-automation, --headless,
// --remote-debugging-pipe and --remote-debugging-port=0 onto the
// AutomationControlled blink feature, which is what navigator.webdriver reads.
// Disabling the feature outright covers every one of those entry points.
const PARITY_ARGS = ['--disable-blink-features=AutomationControlled'];

async function withTempDir(prefix, run) {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
  }
}

async function capturePlaywright({ server, token, extraOptions = {} }) {
  const { chromium } = await importEngine('playwright');
  return withTempDir('bc-parity-pw-', async (userDataDir) => {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: HEADLESS,
      executablePath: CHROME,
      chromiumSandbox: true,
      viewport: null,
      args: LIBRARY_ARGS,
      ignoreDefaultArgs: ['--enable-automation'],
      ...extraOptions,
    });
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(server.url(token), { waitUntil: 'load' });
    const report = await server.waitForReport(token);
    await context.close();
    return report;
  });
}

async function capturePuppeteer({ server, token, extraOptions = {} }) {
  const puppeteer = await importEngine('puppeteer');
  return withTempDir('bc-parity-pp-', async (userDataDir) => {
    const browser = await puppeteer.launch({
      headless: HEADLESS,
      executablePath: CHROME,
      defaultViewport: null,
      userDataDir,
      args: ['--start-maximized', ...LIBRARY_ARGS],
      ...extraOptions,
    });
    const page = (await browser.pages())[0];
    await page.goto(server.url(token), { waitUntil: 'load' });
    const report = await server.waitForReport(token);
    await browser.close();
    return report;
  });
}

/** The shipped launcher, exactly as a caller of the library would get it. */
async function captureLibrary({ server, token, engine, extraOptions = {} }) {
  const { launchBrowser } = await import(
    new URL(
      `file://${path.resolve(process.env.BC_JS_ROOT || 'js', 'src/index.js')}`
    ).href
  );
  return withTempDir(`bc-parity-lib-${engine}-`, async (userDataDir) => {
    const { browser, page } = await launchBrowser({
      engine,
      headless: HEADLESS,
      slowMo: 0,
      executablePath: CHROME,
      userDataDir,
      ...extraOptions,
    });
    await page.goto(server.url(token), { waitUntil: 'load' });
    const report = await server.waitForReport(token);
    await browser.close();
    return report;
  });
}

/** launchRealBrowser style: plain Chrome plus a debugging port, attached over CDP. */
async function captureCdpAttach({ server, token }) {
  const { spawn } = await import('node:child_process');
  const { chromium } = await importEngine('playwright');
  return withTempDir('bc-parity-cdp-', async (userDataDir) => {
    const port = 9500 + Math.floor(Math.random() * 400);
    const child = spawn(
      CHROME,
      [
        `--remote-debugging-port=${port}`,
        '--remote-debugging-address=127.0.0.1',
        `--user-data-dir=${userDataDir}`,
        ...(HEADLESS ? ['--headless=new'] : []),
        ...LIBRARY_ARGS,
        'about:blank',
      ],
      { stdio: 'ignore', detached: true }
    );
    try {
      let browser = null;
      for (let attempt = 0; attempt < 60 && !browser; attempt += 1) {
        try {
          browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      const context = browser.contexts()[0];
      const page = context.pages()[0] || (await context.newPage());
      await page.goto(server.url(token), { waitUntil: 'load' });
      const report = await server.waitForReport(token);
      await browser.close();
      return report;
    } finally {
      await killProcessTree(child);
    }
  });
}

async function main() {
  const probeSource = await readProbeSource();
  const server = await startProbeServer(probeSource);
  const results = {};

  try {
    console.log(`probe server on port ${server.port}, headless=${HEADLESS}`);
    const captures = [
      [
        'reference',
        () =>
          captureReferenceReport({
            executablePath: CHROME,
            server,
            token: 'reference',
            headless: HEADLESS,
            extraArgs: LIBRARY_ARGS,
          }),
      ],
      [
        'referenceSecond',
        () =>
          captureReferenceReport({
            executablePath: CHROME,
            server,
            token: 'reference-2',
            headless: HEADLESS,
            extraArgs: LIBRARY_ARGS,
          }),
      ],
      ['playwright', () => capturePlaywright({ server, token: 'playwright' })],
      [
        'playwrightWithAutomationFlag',
        () =>
          capturePlaywright({
            server,
            token: 'playwright-automation',
            extraOptions: { ignoreDefaultArgs: [] },
          }),
      ],
      ['puppeteer', () => capturePuppeteer({ server, token: 'puppeteer' })],
      [
        'puppeteerWithoutAutomationFlag',
        () =>
          capturePuppeteer({
            server,
            token: 'puppeteer-clean',
            extraOptions: { ignoreDefaultArgs: ['--enable-automation'] },
          }),
      ],
      ['cdpAttach', () => captureCdpAttach({ server, token: 'cdp-attach' })],
      [
        'playwrightParity',
        () =>
          capturePlaywright({
            server,
            token: 'playwright-parity',
            extraOptions: { args: [...LIBRARY_ARGS, ...PARITY_ARGS] },
          }),
      ],
      [
        'puppeteerParity',
        () =>
          capturePuppeteer({
            server,
            token: 'puppeteer-parity',
            extraOptions: {
              args: ['--start-maximized', ...LIBRARY_ARGS, ...PARITY_ARGS],
              ignoreDefaultArgs: ['--enable-automation'],
            },
          }),
      ],
      // The two above pass parity switches through `args`, which is all a
      // caller can do by hand. That is not enough headless: Playwright appends
      // its pointer switch after the caller's arguments, so it has to be
      // suppressed through `ignoreDefaultArgs`, which is what the shipped
      // launcher does. These last two scenarios measure the library itself.
      [
        'libraryPlaywright',
        () =>
          captureLibrary({ server, token: 'library-pw', engine: 'playwright' }),
      ],
      [
        'libraryPuppeteer',
        () =>
          captureLibrary({ server, token: 'library-pp', engine: 'puppeteer' }),
      ],
    ];

    for (const [name, capture] of captures) {
      results[name] = await capture();
      console.log(`captured ${name}`);
    }
  } finally {
    await server.close();
  }

  const diffs = {};
  for (const name of Object.keys(results)) {
    if (name === 'reference') {
      continue;
    }
    diffs[name] = diffReports(results.reference, results[name]);
  }

  const outputPath =
    process.argv[2] || path.join(process.cwd(), 'parity-baseline.json');
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        headless: HEADLESS,
        userAgent: results.reference?.navigator?.userAgent ?? null,
        diffs,
        results,
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  for (const [name, differences] of Object.entries(diffs)) {
    console.log(`\n=== ${name}: ${differences.length} differences ===`);
    for (const difference of differences) {
      console.log(
        `${difference.path}\n  real:      ${JSON.stringify(difference.reference)}\n  automated: ${JSON.stringify(difference.candidate)}`
      );
    }
  }
  console.log(`\nwrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
