/**
 * Catalogue of installed browsers Browser Commander can import from (#114).
 *
 * The data lives in `browser-sources.json`, a shared asset Python and Rust
 * duplicate byte-for-byte (checked by
 * `scripts/check-shared-fingerprint-assets.sh`). This module turns that data
 * into the lookups the rest of the browser code needs: canonical ids with
 * their aliases, the per-platform profile roots, the Chromium Safe Storage
 * identity, and the operating-system identifiers that mark a browser as the
 * system default.
 *
 * Keeping it data-driven is what lets a single JSON edit add Opera, Vivaldi,
 * Arc, a Firefox fork, or a Chrome channel to all three implementations at
 * once, rather than touching hand-written per-platform maps in each language.
 */
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const registry = JSON.parse(
  readFileSync(new URL('./browser-sources.json', import.meta.url), 'utf8')
);

/**
 * Every known browser, in catalogue order.
 *
 * @type {ReadonlyArray<object>}
 */
export const BROWSER_SOURCES = Object.freeze(
  registry.browsers.map((browser) => Object.freeze(browser))
);

/** Canonical ids, in catalogue order. */
export const BROWSER_IDS = Object.freeze(
  BROWSER_SOURCES.map((browser) => browser.id)
);

const BY_NAME = new Map();
for (const browser of BROWSER_SOURCES) {
  BY_NAME.set(browser.id, browser);
  for (const alias of browser.aliases ?? []) {
    BY_NAME.set(alias, browser);
  }
}

function platformPath(platform) {
  return platform === 'win32' ? path.win32 : path;
}

/**
 * Resolve a name (canonical id or alias) to its catalogue entry.
 *
 * @param {string} name
 * @returns {object|undefined}
 */
export function findBrowserSource(name) {
  if (typeof name !== 'string') {
    return undefined;
  }
  return BY_NAME.get(name) ?? BY_NAME.get(name.toLowerCase());
}

/**
 * Resolve a name to its canonical id, throwing a readable error otherwise.
 *
 * @param {string} name
 * @returns {string}
 */
export function normalizeBrowserId(name) {
  return normalizeBrowserSource(name).id;
}

/** The family ('chromium' or 'firefox') of a browser name. */
export function browserFamily(name) {
  return normalizeBrowserSource(name).family;
}

function normalizeBrowserSource(name) {
  const source = findBrowserSource(name);
  if (!source) {
    throw new Error(
      `Unsupported browser: ${name}. Expected one of ${BROWSER_IDS.join(', ')}`
    );
  }
  return source;
}

function templateVariables(platform, homeDir, environment) {
  const pathApi = platformPath(platform);
  if (platform === 'darwin') {
    return {
      home: homeDir,
      appSupport: pathApi.join(homeDir, 'Library', 'Application Support'),
    };
  }
  if (platform === 'win32') {
    return {
      home: homeDir,
      localAppData:
        environment.LOCALAPPDATA ?? pathApi.join(homeDir, 'AppData', 'Local'),
      appData:
        environment.APPDATA ?? pathApi.join(homeDir, 'AppData', 'Roaming'),
    };
  }
  return {
    home: homeDir,
    config: environment.XDG_CONFIG_HOME ?? pathApi.join(homeDir, '.config'),
  };
}

function expandTemplate(template, variables, pathApi) {
  const match = /^\{(\w+)\}(.*)$/.exec(template);
  if (!match) {
    return template;
  }
  const base = variables[match[1]];
  if (base === undefined) {
    return undefined;
  }
  const rest = match[2].split('/').filter(Boolean);
  return pathApi.join(base, ...rest);
}

/**
 * The absolute profile roots a browser uses on a platform. Returns an empty
 * array when the browser does not run on that platform (for example Chrome
 * Canary on Linux).
 *
 * @param {string} name
 * @param {Object} [options]
 * @param {string} [options.platform=process.platform]
 * @param {string} [options.homeDir=os.homedir()]
 * @param {Object} [options.environment=process.env]
 * @returns {string[]}
 */
export function resolveBrowserRoots(
  name,
  {
    platform = process.platform,
    homeDir = os.homedir(),
    environment = process.env,
  } = {}
) {
  const source = normalizeBrowserSource(name);
  const templates = source.roots?.[platform] ?? [];
  const pathApi = platformPath(platform);
  const variables = templateVariables(platform, homeDir, environment);
  const roots = [];
  for (const template of templates) {
    const resolved = expandTemplate(template, variables, pathApi);
    if (resolved !== undefined) {
      roots.push(resolved);
    }
  }
  return roots;
}

/** True when a browser stores one profile in the root itself (Opera-style). */
export function isSingleProfileBrowser(name) {
  return normalizeBrowserSource(name).singleProfile === true;
}

/**
 * The Chromium Safe Storage identity for a browser, or undefined for a
 * Firefox-family browser (which does not use OSCrypt).
 *
 * @param {string} name
 * @returns {{service: string, application: string, folder: string}|undefined}
 */
export function safeStorageIdentity(name) {
  return normalizeBrowserSource(name).safeStorage;
}

/**
 * The operating-system identifiers that mark a browser as the system default:
 * macOS bundle ids, Linux `.desktop` file names, or Windows ProgIds.
 *
 * @param {string} name
 * @param {string} platform
 * @returns {string[]}
 */
export function defaultBrowserIdentifiers(name, platform) {
  return normalizeBrowserSource(name).default?.[platform] ?? [];
}
