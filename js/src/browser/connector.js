import { attachDownloads } from '../downloads/attach.js';
import { connectWebDriver, launchWebDriver } from './webdriver.js';
import {
  loadStorageState,
  restorePlaywrightStorageState,
  restorePuppeteerStorageState,
  restoreWebDriverStorageState,
} from './storage-state.js';

/**
 * Throw unless `engine` is one Browser Commander drives.
 *
 * @param {string} engine
 */
export function assertSupportedEngine(engine) {
  if (!['playwright', 'puppeteer', 'selenium'].includes(engine)) {
    throw new Error(
      `Invalid engine: ${engine}. Expected 'playwright', 'puppeteer' or 'selenium'`
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

async function connectSelenium(options, dependencies) {
  if (Boolean(options.serverUrl) === Boolean(options.cdpEndpoint)) {
    throw new Error(
      'selenium requires exactly one of serverUrl or cdpEndpoint'
    );
  }
  if (options.wsEndpoint) {
    throw new Error('selenium requires an HTTP cdpEndpoint or serverUrl');
  }
  const connected = options.serverUrl
    ? await (dependencies.connectWebDriver ?? connectWebDriver)(options)
    : await (dependencies.launchWebDriver ?? launchWebDriver)({
        ...options,
        debuggerAddress: new URL(options.cdpEndpoint).host,
      });
  return {
    ...connected,
    browser: connected.driver,
    disconnect: connected.close,
  };
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
 * Attach over CDP or create a native session on a WebDriver server.
 *
 * @param {Object} options - Connection options
 * @param {'playwright'|'puppeteer'|'selenium'} [options.engine='playwright'] - Automation engine
 * @param {string} [options.serverUrl] - Selenium Grid or WebDriver server URL
 * @param {Object} [options.capabilities] - Native WebDriver capabilities
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
  if (normalizedOptions.engine === 'selenium') {
    assertSupportedEngine(normalizedOptions.engine);
    const storageState = await prepareStorageState(normalizedOptions);
    const result = await connectSelenium(normalizedOptions, dependencies);
    try {
      await restoreWebDriverStorageState({ page: result.page, storageState });
      const downloads = await attachDownloads({
        ...normalizedOptions,
        ...result,
      });
      return { ...result, downloads };
    } catch (error) {
      await result.close();
      throw error;
    }
  }
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
