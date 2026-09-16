/**
 * Attaching the download manager to a browser (issue #88).
 *
 * Every entry point - `launchBrowser()`, `connectBrowser()`,
 * `launchRealBrowser()` and `commander.configureDownloads()` - goes through
 * this one function, so the managed lifecycle is the same however the browser
 * was obtained. The manager is built from the browser and page, never from the
 * way they were created.
 */

import { createDownloadManager } from './manager.js';

/**
 * Normalize the `downloads` option into manager options.
 *
 * @param {boolean|Object} downloads - `true` for defaults, or an options object
 * @returns {Object|null} Manager options, or null when downloads are off
 */
export function normalizeDownloadOptions(downloads) {
  if (downloads === undefined || downloads === false || downloads === null) {
    return null;
  }
  if (downloads === true) {
    return {};
  }
  if (typeof downloads !== 'object') {
    throw new TypeError(
      'downloads must be true, false or an options object with a directory'
    );
  }
  return downloads;
}

/**
 * Build the download manager for a browser, if the caller asked for one.
 *
 * @param {Object} options - Attachment options
 * @param {string} options.engine - 'playwright' or 'puppeteer'
 * @param {Object} [options.browser] - Browser or persistent context
 * @param {Object} [options.page] - A page belonging to the browser
 * @param {boolean|Object} [options.downloads] - The caller's `downloads` option
 * @param {Object} [options.log] - Logger
 * @returns {Promise<Object>|null} Download manager, or null when not requested
 */
export function attachDownloads({ engine, browser, page, downloads, log }) {
  const managerOptions = normalizeDownloadOptions(downloads);
  if (!managerOptions) {
    return null;
  }

  return createDownloadManager({
    engine,
    browser,
    page,
    log,
    ...managerOptions,
  });
}
