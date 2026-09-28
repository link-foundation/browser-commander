/**
 * The browser an end-to-end suite runs against (issues #87, #88).
 *
 * Every real-browser suite needs the same three things before it can test
 * anything: a throwaway profile, the arguments a sandbox-less container
 * needs, and a directory the browser may write downloads into. Starting a
 * browser is not what those suites are about, so it lives here once and they
 * read as the behaviour they check.
 */

import { existsSync } from 'node:fs';

import { launchBrowser } from '../../src/browser/launcher.js';

/** The installed Chrome the parity suites compare against. */
export const PARITY_CHROME =
  process.env.CHROME_PATH || '/usr/bin/google-chrome';

/**
 * Why a parity suite cannot run here, or `false` when it can.
 *
 * @param {Object} [options]
 * @param {boolean} [options.headless=false] - Headless suites need no display
 * @returns {string|false}
 */
export function paritySkipReason({ headless = false } = {}) {
  if (!process.env.RUN_E2E) {
    return 'set RUN_E2E=true to run the parity tests';
  }
  if (!existsSync(PARITY_CHROME)) {
    return `no Chrome binary at ${PARITY_CHROME}; set CHROME_PATH`;
  }
  if (!headless && process.platform === 'linux' && !process.env.DISPLAY) {
    return 'headful parity needs a display; run under xvfb-run';
  }
  return false;
}

/**
 * Extra Chrome arguments for environments without a usable sandbox.
 *
 * Containers commonly forbid unprivileged user namespaces, where Chromium
 * refuses to start at all; CHROME_NO_SANDBOX=true makes a suite runnable
 * there without weakening how the library launches browsers for everyone else.
 */
export const SANDBOX_ARGS =
  process.env.CHROME_NO_SANDBOX === 'true' ? ['--no-sandbox'] : [];

/**
 * Launch a real browser for one engine, with its own profile.
 *
 * @param {Object} options - Launch options
 * @param {string} options.engine - 'playwright' or 'puppeteer'
 * @param {string} [options.downloadDirectory] - Where managed downloads are kept
 * @returns {Promise<{browser: Object, page: Object, downloads: Object, cleanup: Function}>} The launched browser and a `cleanup` that closes it and removes the profile
 */
export async function launchE2EBrowser(options = {}) {
  const { engine, downloadDirectory } = options;

  // The default launch creates a fresh temporary profile and deletes it on
  // close, so the helper no longer manages one itself.
  const launched = await launchBrowser({
    engine,
    headless: process.env.HEADLESS !== 'false',
    args: SANDBOX_ARGS,
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : {}),
    ...(downloadDirectory
      ? { downloads: { directory: downloadDirectory } }
      : {}),
  });

  return {
    ...launched,
    /**
     * Close the browser and remove the profile this helper created.
     *
     * @returns {Promise<void>} Resolves once both are gone
     */
    cleanup: async () => {
      await launched.close();
    },
  };
}
