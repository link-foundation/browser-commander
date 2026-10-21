import { readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Finding Chrome for Testing in the download caches (issue #179).
 *
 * The engine's own `executablePath()` names one exact build; when that build
 * is not installed, a launch still starts another Chrome for Testing the
 * Playwright, Puppeteer or Selenium Manager caches hold, newest version
 * first. Mirrors `CacheLocations` in `rust/src/browser/chrome_for_testing.rs`.
 */

/** The caches each engine finds Chrome for Testing in, in order. */
export const ENGINE_CACHES = Object.freeze({
  playwright: ['playwright'],
  puppeteer: ['puppeteer'],
  selenium: ['playwright', 'puppeteer', 'selenium'],
});

// name: archive and Selenium cache platform; puppeteer: Puppeteer's prefix.
const PLATFORMS = {
  'linux-x64': { name: 'linux64', puppeteer: 'linux' },
  'darwin-x64': { name: 'mac-x64', puppeteer: 'mac' },
  'darwin-arm64': { name: 'mac-arm64', puppeteer: 'mac_arm' },
  'win32-x64': { name: 'win64', puppeteer: 'win64' },
  'win32-ia32': { name: 'win32', puppeteer: 'win32' },
};

/**
 * Where the caches are on this machine, or `undefined` where Chrome for
 * Testing is not built for the platform.
 *
 * @param {Object} [machine]
 * @param {string} [machine.platform] - `process.platform`
 * @param {string} [machine.arch] - `process.arch`
 * @param {string} [machine.home] - The home directory
 * @param {Object} [machine.env] - The environment variables
 */
export function cacheLocations({
  platform = process.platform,
  arch = process.arch,
  home = os.homedir(),
  env = process.env,
} = {}) {
  const known = PLATFORMS[platformKey(platform, arch)];
  return known ? { platform, ...known, home, env } : undefined;
}

function platformKey(platform, arch) {
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  }
  if (platform === 'win32') {
    return arch === 'ia32' ? 'win32-ia32' : 'win32-x64';
  }
  return `${platform}-${arch}`;
}

function variable(locations, name) {
  return locations.env[name] || undefined;
}

function homePath(locations, ...relative) {
  return locations.home ? path.join(locations.home, ...relative) : undefined;
}

const ROOTS = {
  playwright(locations) {
    const root = locations.env.PLAYWRIGHT_BROWSERS_PATH;
    if (root) {
      // `0` keeps the browsers inside node_modules, where only the
      // Playwright package itself knows the path.
      return root === '0' ? undefined : root;
    }
    if (locations.platform === 'win32') {
      const local = variable(locations, 'LOCALAPPDATA');
      return local && path.join(local, 'ms-playwright');
    }
    if (locations.platform === 'darwin') {
      return homePath(locations, 'Library', 'Caches', 'ms-playwright');
    }
    const cache = variable(locations, 'XDG_CACHE_HOME');
    return cache
      ? path.join(cache, 'ms-playwright')
      : homePath(locations, '.cache', 'ms-playwright');
  },
  puppeteer: (locations) =>
    variable(locations, 'PUPPETEER_CACHE_DIR') ??
    homePath(locations, '.cache', 'puppeteer'),
  selenium: (locations) =>
    variable(locations, 'SE_CACHE_PATH') ??
    homePath(locations, '.cache', 'selenium'),
};

/** The binary inside an unpacked Chrome for Testing directory. */
function binary(locations) {
  if (locations.platform === 'darwin') {
    return path.join(
      'Google Chrome for Testing.app',
      'Contents',
      'MacOS',
      'Google Chrome for Testing'
    );
  }
  return locations.platform === 'win32' ? 'chrome.exe' : 'chrome';
}

/** A dotted version (`131.0.6778.204`) or revision (`1248`) as numbers. */
function versionKey(text) {
  return text !== undefined && /^\d+(\.\d+)*$/u.test(text)
    ? text.split('.').map(Number)
    : undefined;
}

function compareVersions(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? -1) - (right[index] ?? -1);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function isDirectory(file) {
  try {
    return statSync(file).isDirectory();
  } catch {
    return false;
  }
}

/** The directories in `root` whose name `key` parses, newest first. */
function newestFirst(root, key) {
  let names;
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  return names
    .map((name) => ({ version: key(name), directory: path.join(root, name) }))
    .filter(({ version, directory }) => version && isDirectory(directory))
    .sort((left, right) => compareVersions(right.version, left.version))
    .map(({ directory }) => directory);
}

const withPrefix = (prefix) => (name) =>
  name.startsWith(prefix) ? versionKey(name.slice(prefix.length)) : undefined;

/**
 * The Chrome for Testing binaries `cache` may hold, newest version first.
 * The paths are candidates: the caller checks they exist.
 *
 * @param {'playwright'|'puppeteer'|'selenium'} cache
 * @param {Object} locations - From {@link cacheLocations}
 * @returns {string[]}
 */
export function chromeForTestingCandidates(cache, locations) {
  const root = ROOTS[cache](locations);
  if (!root) {
    return [];
  }
  const archive = `chrome-${locations.name}`;
  const file = binary(locations);
  if (cache === 'selenium') {
    return newestFirst(
      path.join(root, 'chrome', locations.name),
      versionKey
    ).map((directory) => path.join(directory, file));
  }
  const directories =
    cache === 'playwright'
      ? newestFirst(root, withPrefix('chromium-'))
      : newestFirst(
          path.join(root, 'chrome'),
          withPrefix(`${locations.puppeteer}-`)
        );
  return directories.map((directory) => path.join(directory, archive, file));
}

/**
 * The Chrome for Testing candidates in the caches `engine` uses, in order.
 *
 * @param {string} engine
 * @param {Object} [machine] - See {@link cacheLocations}
 * @returns {string[]}
 */
export function cachedChromeForTesting(engine, machine) {
  const locations = cacheLocations(machine);
  if (!locations) {
    return [];
  }
  return (ENGINE_CACHES[engine] ?? []).flatMap((cache) =>
    chromeForTestingCandidates(cache, locations)
  );
}
