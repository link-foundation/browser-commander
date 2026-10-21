import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { LAUNCH_RESTRICTION_PRESETS } from './restrictions.js';
import { resolveSystemBrowserExecutable } from './system-browser.js';

/**
 * Which browser binary an automation launch starts (issue #179).
 *
 * Without `channel` or `executablePath` a launch starts Chrome for Testing,
 * the browser Playwright and Puppeteer download. It is an application of its
 * own (`com.google.chrome.for.testing` on macOS), so the user's Google Chrome
 * - its Dock icon, its new tabs, the links other apps open - never goes to the
 * automation window. The installed Google Chrome is used only on request.
 */

const ENGINE_BROWSERS = {
  playwright: async () => (await import('playwright')).chromium,
  puppeteer: async () => (await import('puppeteer')).default,
};

// Selenium has no browser of its own; it starts the one Playwright or
// Puppeteer downloaded.
const BUNDLED_BROWSER_ENGINES = {
  playwright: ['playwright'],
  puppeteer: ['puppeteer'],
  selenium: ['playwright', 'puppeteer'],
};

const INSTALL_COMMANDS = {
  playwright: 'npx playwright install chromium',
  puppeteer: 'npx puppeteer browsers install chrome',
};

// Chrome for Testing archives unpack to chrome-<platform>; the macOS app is
// "Google Chrome for Testing.app". Playwright's older own Chromium builds
// (chrome-linux, chrome-win, Chromium.app) are not Chrome for Testing.
const CHROME_FOR_TESTING_DIRECTORIES = new Set([
  'chrome-linux64',
  'chrome-win64',
  'chrome-win32',
  'chrome-mac-x64',
  'chrome-mac-arm64',
]);
const SELENIUM_CACHE_PLATFORMS = new Set([
  'linux64',
  'win64',
  'win32',
  'mac-x64',
  'mac-arm64',
]);

/** The restrictions every Chrome for Testing launch gets by default. */
export const CHROME_FOR_TESTING_RESTRICTIONS =
  LAUNCH_RESTRICTION_PRESETS['chrome-for-testing'];

/**
 * Whether an executable is a Chrome for Testing build, judged by its install
 * path: Playwright, Puppeteer, `@puppeteer/browsers` and Selenium Manager all
 * keep it under a Chrome for Testing archive directory.
 *
 * @param {string} [executablePath]
 * @returns {boolean}
 */
export function isChromeForTesting(executablePath) {
  if (typeof executablePath !== 'string') {
    return false;
  }
  const segments = executablePath.toLowerCase().split(/[\\/]+/u);
  if (
    segments.some(
      (segment) =>
        segment.includes('chrome for testing') ||
        CHROME_FOR_TESTING_DIRECTORIES.has(segment)
    )
  ) {
    return true;
  }
  // Selenium Manager: ~/.cache/selenium/chrome/<platform>/<version>/chrome
  const selenium = segments.lastIndexOf('selenium');
  return (
    selenium >= 0 &&
    segments[selenium + 1] === 'chrome' &&
    SELENIUM_CACHE_PLATFORMS.has(segments[selenium + 2])
  );
}

/**
 * The restrictions a launch of `executablePath` gets unless the caller sets
 * `defaultRestrictions`: the `chrome-for-testing` preset for Chrome for
 * Testing, nothing for any other browser.
 *
 * @param {string} executablePath
 * @param {string[]} [requested] - The caller's `defaultRestrictions`
 * @returns {string[]}
 */
export function defaultRestrictionsFor(executablePath, requested) {
  if (requested !== undefined) {
    return requested;
  }
  return isChromeForTesting(executablePath)
    ? [...CHROME_FOR_TESTING_RESTRICTIONS]
    : [];
}

async function isExecutable(file) {
  try {
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function bundledExecutable(load) {
  const executable = await load()
    .then((module) => module.executablePath())
    .catch(() => undefined);
  return executable && (await isExecutable(executable))
    ? executable
    : undefined;
}

/**
 * Pick the browser binary for a launch.
 *
 * An explicit `executablePath` or `channel` is honoured as given. Without
 * either, the engine's downloaded Chrome for Testing is started; Selenium
 * uses Playwright's, then Puppeteer's. The installed Google Chrome is never a
 * silent fallback: without Chrome for Testing the launch fails and says how
 * to install it or how to ask for Google Chrome.
 */
export async function resolveLaunchExecutable(
  { engine, channel, executablePath },
  { resolveSystem = resolveSystemBrowserExecutable, loadEngineModule } = {}
) {
  if (executablePath !== undefined || channel !== undefined) {
    return await resolveSystem({
      channel: channel ?? 'chrome',
      executablePath,
    });
  }
  const engines = BUNDLED_BROWSER_ENGINES[engine] ?? [];
  const loaders = loadEngineModule
    ? [loadEngineModule]
    : engines.map((name) => ENGINE_BROWSERS[name]);
  for (const load of loaders) {
    const executable = await bundledExecutable(load);
    if (executable) {
      return executable;
    }
  }
  const install = engines
    .map((name) => `\`${INSTALL_COMMANDS[name]}\``)
    .join(' or ');
  throw new Error(
    `Chrome for Testing is not installed for ${engine}: run ${install}, or pass channel: 'chrome' to start the installed Google Chrome`
  );
}
