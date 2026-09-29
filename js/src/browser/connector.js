import { attachDownloads } from '../downloads/attach.js';
import {
  loadStorageState,
  restorePlaywrightStorageState,
  restorePuppeteerStorageState,
} from './storage-state.js';

/**
 * Throw unless `engine` is one Browser Commander drives.
 *
 * @param {string} engine
 */
export function assertSupportedEngine(engine) {
  if (!['playwright', 'puppeteer'].includes(engine)) {
    throw new Error(
      `Invalid engine: ${engine}. Expected 'playwright' or 'puppeteer'`
    );
  }
}

function validateConnectionOptions({ engine, cdpEndpoint, wsEndpoint }) {
  assertSupportedEngine(engine);

  if (Boolean(cdpEndpoint) === Boolean(wsEndpoint)) {
    throw new Error(
      'connectBrowser requires exactly one of cdpEndpoint or wsEndpoint'
    );
  }
}

function addDefinedOptions(options, values) {
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      options[key] = value;
    }
  }
  return options;
}

function buildPlaywrightConnectOptions({ slowMo, timeout, headers }) {
  return addDefinedOptions({}, { slowMo, timeout, headers });
}

function buildPuppeteerConnectOptions({
  cdpEndpoint,
  wsEndpoint,
  slowMo,
  protocolTimeout,
  headers,
}) {
  return addDefinedOptions(
    {
      ...(cdpEndpoint
        ? { browserURL: cdpEndpoint }
        : { browserWSEndpoint: wsEndpoint }),
      defaultViewport: null,
    },
    { slowMo, protocolTimeout, headers }
  );
}

async function prepareStorageState({ storageState, seedCookies }) {
  if (seedCookies !== undefined && !Array.isArray(seedCookies)) {
    throw new TypeError('seedCookies must be an array');
  }

  const resolvedStorageState = await loadStorageState(storageState);
  if (!resolvedStorageState && seedCookies === undefined) {
    return undefined;
  }

  return {
    ...(resolvedStorageState ?? {}),
    cookies: [...(resolvedStorageState?.cookies ?? []), ...(seedCookies ?? [])],
  };
}

/**
 * Pick the tab that is on screen.
 *
 * A browser attached after it started can already have several tabs - a fresh
 * Chrome profile opens "What's new" next to the New Tab page - and neither
 * engine lists them in a stable order. Driving a background tab would make
 * `document.hidden` true where a person's first navigation would see a visible
 * page, so the visible tab wins and the first tab is the fallback.
 *
 * @param {Object[]} pages - Engine page handles
 * @returns {Promise<Object|undefined>}
 */
export async function pickForegroundPage(pages) {
  for (const page of pages) {
    if (typeof page?.evaluate !== 'function') {
      continue;
    }
    const state = await page
      .evaluate(() => document.visibilityState)
      .catch(() => null);
    if (state === 'visible') {
      return page;
    }
  }
  return pages[0];
}

async function connectPlaywright({ options, loadPlaywright, storageState }) {
  const { chromium } = await loadPlaywright();
  const endpoint = options.cdpEndpoint ?? options.wsEndpoint;
  const browser = await chromium.connectOverCDP(
    endpoint,
    buildPlaywrightConnectOptions(options)
  );
  const context = browser.contexts()[0];
  if (!context) {
    throw new Error('Connected Playwright browser has no default context');
  }
  const page =
    (await pickForegroundPage(context.pages())) ?? (await context.newPage());

  await restorePlaywrightStorageState({ context, storageState });
  return { browser, page };
}

async function connectPuppeteer({ options, loadPuppeteer, storageState }) {
  const puppeteerModule = await loadPuppeteer();
  const puppeteer = puppeteerModule.default ?? puppeteerModule;
  const browser = await puppeteer.connect(
    buildPuppeteerConnectOptions(options)
  );
  const page =
    (await pickForegroundPage(await browser.pages())) ??
    (await browser.newPage());

  await restorePuppeteerStorageState({ page, storageState });
  return { browser, page };
}

/**
 * Attach to an already-running Chromium-family browser over CDP.
 *
 * @param {Object} options - Connection options
 * @param {'playwright'|'puppeteer'} [options.engine='playwright'] - Automation engine
 * @param {string} [options.cdpEndpoint] - HTTP DevTools endpoint, such as http://127.0.0.1:9222
 * @param {string} [options.wsEndpoint] - DevTools browser WebSocket endpoint
 * @param {number} [options.slowMo] - Delay engine operations by this many milliseconds
 * @param {number} [options.timeout] - Playwright connection timeout in milliseconds
 * @param {number} [options.protocolTimeout] - Puppeteer CDP call timeout in milliseconds
 * @param {Object<string,string>} [options.headers] - Additional connection headers
 * @param {Object[]|string|Object} [options.storageState] - Playwright-compatible state path or object
 * @param {Object[]} [options.seedCookies] - Cookies to seed after connecting
 * @param {boolean} [options.verbose=false] - Enable connection logging
 * @param {boolean|Object} [options.downloads] - Manage downloads: true for defaults, or {directory, persist, conflict}
 * @returns {Promise<{browser: Object, page: Object, downloads: Object|null}>} Raw handles and the download manager when one was requested
 */
export async function connectBrowser(options = {}) {
  return await connectBrowserWithDependencies(options);
}

/**
 * Dependency-injected implementation used by the public connector and tests.
 *
 * @param {Object} options - See {@link connectBrowser}
 * @param {Object} dependencies - Optional engine module loaders
 * @returns {Promise<{browser: Object, page: Object, downloads: Object|null}>} Raw handles and the download manager when one was requested
 */
export async function connectBrowserWithDependencies(
  options = {},
  dependencies = {}
) {
  const normalizedOptions = {
    engine: 'playwright',
    verbose: false,
    ...options,
  };
  validateConnectionOptions(normalizedOptions);

  const storageState = await prepareStorageState(normalizedOptions);
  const { engine, verbose } = normalizedOptions;
  if (verbose) {
    console.log(`Connecting to browser with ${engine} engine...`);
  }

  const result =
    engine === 'playwright'
      ? await connectPlaywright({
          options: normalizedOptions,
          loadPlaywright:
            dependencies.loadPlaywright ?? (() => import('playwright')),
          storageState,
        })
      : await connectPuppeteer({
          options: normalizedOptions,
          loadPuppeteer:
            dependencies.loadPuppeteer ?? (() => import('puppeteer')),
          storageState,
        });

  if (verbose) {
    console.log(`Connected to browser with ${engine} engine`);
  }

  // An attached browser gets the same managed lifecycle as a launched one:
  // the manager is built from the browser and page, not from how we got them.
  const downloads = await attachDownloads({
    engine,
    browser: result.browser,
    page: result.page,
    downloads: normalizedOptions.downloads,
  });

  return { ...result, downloads };
}

export { buildPlaywrightConnectOptions, buildPuppeteerConnectOptions };
