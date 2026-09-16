/**
 * Engine-specific download event sources (issue #88).
 *
 * Each source turns one engine's download notifications into the same three
 * calls - `started`, `finished`, `failed` - so the manager above them does not
 * know or care whether the bytes came from Playwright or from CDP, and a
 * download a human started by hand is reported exactly like an automated one.
 */

import path from 'node:path';
import fs from 'node:fs/promises';

import { ARTIFACT_DIRECTORY_MODE } from './destination.js';

/** Why a download ended without a file. */
export const DOWNLOAD_FAILURE = Object.freeze({
  CANCELLED: 'cancelled',
  FAILED: 'failed',
});

/** Directory the engine writes into before we place the file. */
export const STAGING_DIRECTORY = '.browser-commander-staging';

/**
 * Classify an engine's failure text.
 *
 * "A download UI entry is not completion evidence" (issue #88): the engine's
 * own words are the only thing that distinguishes a user cancelling a download
 * from a network error, so they are preserved and classified, not flattened.
 *
 * @param {string} [reason] - Engine-reported reason
 * @returns {string} One of {@link DOWNLOAD_FAILURE}
 */
export function classifyFailure(reason) {
  return /cancel/i.test(String(reason ?? ''))
    ? DOWNLOAD_FAILURE.CANCELLED
    : DOWNLOAD_FAILURE.FAILED;
}

/**
 * Attach to Playwright's context-level download event.
 *
 * @param {Object} options - Source options
 * @param {Object} options.context - Playwright browser context
 * @param {Object} options.sink - `{started, finished, failed}` callbacks
 * @returns {Object} Handle with `detach()`
 */
export function attachPlaywrightSource({ context, sink }) {
  const onDownload = async (download) => {
    const record = sink.started({
      engineHandle: download,
      url: download.url(),
      suggestedFilename: download.suggestedFilename(),
      page: download.page?.(),
    });

    try {
      const failure = await download.failure();
      if (failure) {
        sink.failed(record, classifyFailure(failure), failure);
        return;
      }

      // `path()` resolves only once the bytes are on disk, which is the
      // engine's own evidence that the download completed.
      const enginePath = await download.path();
      sink.finished(record, { path: enginePath });
    } catch (error) {
      sink.failed(record, classifyFailure(error.message), error.message);
    }
  };

  context.on('download', onDownload);
  return {
    detach: () => context.off('download', onDownload),
  };
}

/**
 * Point Chromium at a staging directory and report every download it starts.
 *
 * This is the only source that sees a download a *person* started, because
 * `Browser.setDownloadBehavior` is browser-wide rather than per-automation.
 *
 * @param {Object} options - Source options
 * @param {Object} options.session - CDP session with Browser domain access
 * @param {string} options.root - Managed download directory
 * @param {Object} options.sink - `{started, finished, failed}` callbacks
 * @returns {Promise<Object>} Handle with `detach()` and `stagingDirectory`
 */
export async function attachCdpSource({ session, root, sink }) {
  const stagingDirectory = path.join(root, STAGING_DIRECTORY);
  await fs.mkdir(stagingDirectory, {
    recursive: true,
    mode: ARTIFACT_DIRECTORY_MODE,
  });

  // `allowAndName` writes each file under its GUID, so two downloads that
  // suggest the same name cannot overwrite each other before we have placed
  // them, and the GUID is the identity we deduplicate on.
  await session.send('Browser.setDownloadBehavior', {
    behavior: 'allowAndName',
    downloadPath: stagingDirectory,
    eventsEnabled: true,
  });

  const byGuid = new Map();

  const onWillBegin = ({ guid, url, suggestedFilename }) => {
    byGuid.set(
      guid,
      sink.started({
        engineHandle: guid,
        url,
        suggestedFilename,
      })
    );
  };

  const onProgress = ({ guid, state }) => {
    const record = byGuid.get(guid);
    if (!record || state === 'inProgress') {
      return;
    }

    byGuid.delete(guid);
    if (state === 'completed') {
      sink.finished(record, {
        path: path.join(stagingDirectory, guid),
        removeSource: true,
      });
      return;
    }
    sink.failed(
      record,
      DOWNLOAD_FAILURE.CANCELLED,
      `download ${state} by the browser`
    );
  };

  session.on('Browser.downloadWillBegin', onWillBegin);
  session.on('Browser.downloadProgress', onProgress);

  return {
    stagingDirectory,
    detach: () => {
      session.off?.('Browser.downloadWillBegin', onWillBegin);
      session.off?.('Browser.downloadProgress', onProgress);
    },
  };
}

/**
 * Open a CDP session that can drive the Browser domain.
 *
 * Puppeteer exposes this on the browser connection; Playwright exposes it per
 * page. Either way the Browser domain is browser-wide, so one session is
 * enough for every page and for downloads no page started.
 *
 * @param {Object} options - Session options
 * @param {string} options.engine - Engine name
 * @param {Object} [options.browser] - Browser or persistent context
 * @param {Object} [options.page] - Page to borrow a session from
 * @returns {Promise<Object>|undefined} CDP session, or undefined when unavailable
 */
export function openBrowserCdpSession({ engine, browser, page }) {
  if (engine === 'puppeteer') {
    const target = browser?.target?.();
    if (target?.createCDPSession) {
      return target.createCDPSession();
    }
    return page?.target?.().createCDPSession?.();
  }

  const context = browser?.browserContext?.() ?? browser;
  if (page && context?.newCDPSession) {
    return context.newCDPSession(page);
  }
  return undefined;
}
