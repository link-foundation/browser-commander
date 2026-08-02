import {
  loadStorageState,
  restorePlaywrightStorageState,
  restorePuppeteerStorageState,
} from './storage-state.js';

function validateConnectionOptions({ engine, cdpEndpoint, wsEndpoint }) {
  if (!['playwright', 'puppeteer'].includes(engine)) {
    throw new Error(
      `Invalid engine: ${engine}. Expected 'playwright' or 'puppeteer'`
    );
  }

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
  const page = context.pages()[0] ?? (await context.newPage());

  await restorePlaywrightStorageState({ context, storageState });
  return { browser, page };
}

async function connectPuppeteer({ options, loadPuppeteer, storageState }) {
  const puppeteerModule = await loadPuppeteer();
  const puppeteer = puppeteerModule.default ?? puppeteerModule;
  const browser = await puppeteer.connect(
    buildPuppeteerConnectOptions(options)
  );
  const pages = await browser.pages();
  const page = pages[0] ?? (await browser.newPage());

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
 * @returns {Promise<{browser: Object, page: Object}>} Raw browser and page handles
 */
export async function connectBrowser(options = {}) {
  return await connectBrowserWithDependencies(options);
}

/**
 * Dependency-injected implementation used by the public connector and tests.
 *
 * @param {Object} options - See {@link connectBrowser}
 * @param {Object} dependencies - Optional engine module loaders
 * @returns {Promise<{browser: Object, page: Object}>} Raw browser and page handles
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
  return result;
}

export { buildPlaywrightConnectOptions, buildPuppeteerConnectOptions };
