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
import {
  DEFAULT_STAGING_POLL_INTERVAL,
  DEFAULT_STAGING_TIMEOUT,
  describeStagingTimeout,
  waitForStagedFile,
} from './staging.js';

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
 * @param {Object} options.sink - `{started, finished, failed, track}` callbacks
 * @param {string} [options.browserContextId] - Chromium context to configure
 * @param {number} [options.stagingTimeout] - Budget for the bytes to land on disk
 * @param {number} [options.stagingPollInterval] - Milliseconds between readings
 * @returns {Promise<Object>} Handle with `detach()` and `stagingDirectory`
 */
export async function attachCdpSource({
  session,
  root,
  sink,
  browserContextId,
  stagingTimeout,
  stagingPollInterval,
}) {
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
    ...(browserContextId ? { browserContextId } : {}),
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

  /**
   * Publish a completed download once its staged bytes are readable.
   *
   * `state: "completed"` is the browser's word, not the filesystem's. Chromium
   * writes `<guid>.crdownload` and renames it, so opening `<guid>` the instant
   * the event arrives could - and did, in issue #92 - fail with `ENOENT` on a
   * download that had in fact succeeded. Waiting for the file turns that race
   * into either a saved artifact or a named failure, never a lost one.
   *
   * @param {Object} record - Artifact record
   * @param {string} stagedPath - Path Chromium staged the bytes under
   * @returns {Promise<void>}
   */
  const publishWhenStaged = async (record, stagedPath) => {
    const budget = stagingTimeout ?? DEFAULT_STAGING_TIMEOUT;
    const settled = await waitForStagedFile({
      path: stagedPath,
      timeout: budget,
      interval: stagingPollInterval ?? DEFAULT_STAGING_POLL_INTERVAL,
    });

    if (!settled.ready) {
      sink.failed(
        record,
        DOWNLOAD_FAILURE.FAILED,
        describeStagingTimeout({
          path: stagedPath,
          timeout: budget,
          reason: settled.reason,
        })
      );
      return;
    }

    await sink.finished(record, { path: stagedPath, removeSource: true });
  };

  const onProgress = ({ guid, state }) => {
    const record = byGuid.get(guid);
    if (!record || state === 'inProgress') {
      return;
    }

    byGuid.delete(guid);
    if (state === 'completed') {
      // Tracked before it is awaited: the wait is part of the download's
      // lifecycle, so `idle()` and `dispose()` must not return while it runs.
      sink.track(publishWhenStaged(record, path.join(stagingDirectory, guid)));
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
 * Read the Chromium browser-context id that owns a page.
 *
 * `Browser.setDownloadBehavior` is sent over a browser-wide session so its
 * events cover the whole browser, but omitting `browserContextId` configures
 * only Chromium's default context. Playwright's `browser.newPage()` convenience
 * API creates a non-default context, whose id is exposed by its target.
 *
 * @param {Object} options - Browser handles
 * @param {string} options.engine - Engine name
 * @param {Object} [options.browser] - Browser or persistent context
 * @param {Object} [options.page] - Page whose context downloads belong to
 * @param {Object} [options.browserSession] - Browser-wide CDP session
 * @returns {Promise<string|undefined>} Chromium context id, when non-default
 */
export async function browserContextIdForPage({
  engine,
  browser,
  page,
  browserSession,
}) {
  if (engine !== 'playwright' || !page) {
    return undefined;
  }

  const context = page.context?.() ?? browser;
  // Playwright exposes a persistent context as the browser's default context:
  // unlike browser.newContext(), its `browser()` is null. Keeping the id
  // absent preserves default-context behavior, including downloads from tabs
  // opened outside the automation.
  if (typeof context?.browser === 'function' && !context.browser()) {
    return undefined;
  }
  const pageSession = await context?.newCDPSession?.(page);
  if (!pageSession) {
    return undefined;
  }

  let browserContextId;
  try {
    const { targetInfo } = await pageSession.send('Target.getTargetInfo');
    browserContextId = targetInfo?.browserContextId || undefined;
  } finally {
    // This session exists only for target metadata. A failure to detach it
    // must not discard the id that lets the long-lived source work correctly.
    await pageSession.detach?.().catch?.(() => {});
  }
  if (!browserContextId || !browserSession) {
    return browserContextId;
  }

  try {
    // TargetInfo also reports an opaque id for a persistent/default context in
    // current Chromium. Only ids returned here are true non-default contexts
    // accepted by Browser.setDownloadBehavior's browserContextId parameter.
    const { browserContextIds = [] } = await browserSession.send(
      'Target.getBrowserContexts'
    );
    return browserContextIds.includes(browserContextId)
      ? browserContextId
      : undefined;
  } catch {
    // Older/page-scoped CDP bridges may not expose getBrowserContexts. The
    // persistent-context guard above handles their known default-context case.
    return browserContextId;
  }
}

/**
 * Open a CDP session that can drive the Browser domain.
 *
 * Both engines can open a session that is not tied to a single page, which is
 * what the Browser domain needs: one session then covers every page and every
 * download no page started.
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

  // A page-scoped session only hears about the downloads that page started,
  // so a browser-wide session is what makes a download a *person* began - in a
  // tab the automation never opened - observable at all.
  const browserHandle = browser?.browser?.() ?? browser;
  if (browserHandle?.newBrowserCDPSession) {
    return browserHandle.newBrowserCDPSession();
  }

  const context = browser?.browserContext?.() ?? browser;
  if (page && context?.newCDPSession) {
    return context.newCDPSession(page);
  }
  return undefined;
}
