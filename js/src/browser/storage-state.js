import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { normalizeSessionCookies } from './session-cookies.js';

/**
 * Load a Playwright-compatible storage state from a JSON path or object.
 * @param {string|Object|undefined} storageState - State path or parsed state
 * @returns {Promise<Object|undefined>} Parsed state
 */
export async function loadStorageState(storageState) {
  if (storageState === undefined) {
    return undefined;
  }
  if (typeof storageState === 'string') {
    return JSON.parse(await readFile(storageState, 'utf8'));
  }
  if (storageState && typeof storageState === 'object') {
    return storageState;
  }
  throw new TypeError('storageState must be a file path or an object');
}

function restoreOriginLocalStorage(origins) {
  const originState = origins.find(
    ({ origin }) => origin === globalThis.location.origin
  );
  if (!originState) {
    return;
  }
  for (const { name, value } of originState.localStorage ?? []) {
    globalThis.localStorage.setItem(name, value);
  }
}

/** Restore classic WebDriver cookies; origin preload scripts require BiDi. */
export async function restoreWebDriverStorageState({
  page,
  storageState,
  seedCookies = [],
}) {
  storageState = await loadStorageState(storageState);
  if (!storageState && !seedCookies.length) {
    return;
  }
  const origins = storageState?.origins ?? [];
  if (origins.length) {
    if (!page.browserName?.toLowerCase().startsWith('safari')) {
      await page.evaluateOnNewDocument(restoreOriginLocalStorage, origins);
      await page.evaluate(restoreOriginLocalStorage, origins);
    }
  }
  const originalUrl = page.url();
  const cookies = [...(storageState?.cookies ?? []), ...seedCookies];
  try {
    for (const cookie of cookies) {
      const origin = cookie.url
        ? new URL(cookie.url).origin
        : (origins.find(
            ({ origin }) =>
              new URL(origin).hostname === cookie.domain?.replace(/^\./u, '')
          )?.origin ??
          `${cookie.secure ? 'https' : 'http'}://${cookie.domain.replace(/^\./u, '')}`);
      await page.goto(origin);
      await page.setCookie(cookie);
    }
    if (page.browserName?.toLowerCase().startsWith('safari')) {
      for (const { origin } of origins) {
        await page.goto(origin);
        await page.evaluate(restoreOriginLocalStorage, origins);
      }
    }
  } finally {
    if (
      cookies.length ||
      (origins.length && page.browserName?.toLowerCase().startsWith('safari'))
    ) {
      await page.goto(originalUrl);
    }
  }
}

/**
 * Apply Playwright-compatible storage state to a Puppeteer page.
 * @param {Object} options - Restore options
 * @param {Object} options.page - Puppeteer page
 * @param {Object|undefined} options.storageState - Parsed storage state
 * @returns {Promise<void>}
 */
export async function restorePuppeteerStorageState({ page, storageState }) {
  if (!storageState) {
    return;
  }

  const cookies = storageState.cookies ?? [];
  if (cookies.length > 0) {
    const context = page.browserContext?.();
    const target = typeof context?.setCookie === 'function' ? context : page;
    await target.setCookie(...normalizeSessionCookies(cookies, 'puppeteer'));
  }

  const origins = storageState.origins ?? [];
  if (origins.length > 0) {
    await page.evaluateOnNewDocument(restoreOriginLocalStorage, origins);
    await page.evaluate(restoreOriginLocalStorage, origins);
  }
}

/**
 * Apply storage state to a Playwright persistent browser context.
 * @param {Object} options - Restore options
 * @param {Object} options.context - Playwright browser context
 * @param {Object|undefined} options.storageState - Parsed storage state
 * @returns {Promise<void>}
 */
export async function restorePlaywrightStorageState({ context, storageState }) {
  if (!storageState) {
    return;
  }

  const cookies = storageState.cookies ?? [];
  if (cookies.length > 0) {
    await context.addCookies(normalizeSessionCookies(cookies, 'playwright'));
  }

  const origins = storageState.origins ?? [];
  if (origins.length > 0) {
    await context.addInitScript(restoreOriginLocalStorage, origins);
    await Promise.all(
      context
        .pages()
        .map((page) => page.evaluate(restoreOriginLocalStorage, origins))
    );
  }
}

function readCurrentLocalStorage() {
  return Array.from({ length: globalThis.localStorage.length }, (_, index) => {
    const name = globalThis.localStorage.key(index);
    return { name, value: globalThis.localStorage.getItem(name) };
  });
}

async function collectPuppeteerStorageState(page) {
  const context = page.browserContext?.();
  const cookies =
    typeof context?.cookies === 'function'
      ? await context.cookies()
      : await page.cookies();
  const pageUrl = page.url();
  const origin = new URL(pageUrl).origin;
  const origins = [];

  if (origin !== 'null') {
    origins.push({
      origin,
      localStorage: await page.evaluate(readCurrentLocalStorage),
    });
  }

  return { cookies, origins };
}

/**
 * Save a page's cookies and localStorage in Playwright's storage-state format.
 * @param {Object} page - Playwright or Puppeteer page
 * @param {string} [filePath] - Optional JSON output path
 * @returns {Promise<Object>} Saved storage state
 */
export async function saveStorageState(page, filePath) {
  const context = typeof page.context === 'function' ? page.context() : null;
  if (typeof context?.storageState === 'function') {
    const state = await context.storageState();
    if (filePath) {
      await writeRestrictedState(filePath, state);
    }
    return state;
  }

  if (
    typeof page.cookies !== 'function' ||
    typeof page.evaluate !== 'function' ||
    typeof page.url !== 'function'
  ) {
    throw new TypeError('page must be a Playwright or Puppeteer page');
  }

  const storageState = await collectPuppeteerStorageState(page);
  if (filePath) {
    await writeRestrictedState(filePath, storageState);
  }
  return storageState;
}

/** Replace state atomically with an owner-only file, without following a destination symlink. */
export async function writeRestrictedState(filePath, state) {
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}
