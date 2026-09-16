/**
 * The browser an end-to-end suite runs against (issues #87, #88).
 *
 * Every real-browser suite needs the same three things before it can test
 * anything: a throwaway profile, the arguments a sandbox-less container
 * needs, and a directory the browser may write downloads into. Starting a
 * browser is not what those suites are about, so it lives here once and they
 * read as the behaviour they check.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { launchBrowser } from '../../src/browser/launcher.js';

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
  const userDataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'bc-e2e-profile-')
  );

  const launched = await launchBrowser({
    engine,
    userDataDir,
    headless: process.env.HEADLESS !== 'false',
    slowMo: 0,
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
      await launched.browser?.close();
      await fs.rm(userDataDir, { recursive: true, force: true });
    },
  };
}
