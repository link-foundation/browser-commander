/**
 * Managed, persistent downloads (issue #88).
 *
 * The manager owns one lifecycle for every download the browser performs -
 * automated or started by a person - and guarantees three things a caller
 * cannot get from an engine event alone:
 *
 * - the file survives the page, context and browser that produced it;
 * - a download is saved once and reported once, even when a global listener
 *   and an awaited `capture()` both see it;
 * - a file under its final name is complete and has passed validation.
 */

import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';

import { createDeadline } from '../core/readiness.js';
import {
  prepareDownloadDirectory,
  resolveDownloadDirectory,
} from './destination.js';
import {
  attachCdpSource,
  attachPlaywrightSource,
  classifyFailure,
  DOWNLOAD_FAILURE,
  openBrowserCdpSession,
} from './sources.js';
import { DOWNLOAD_CONFLICT, saveDownload } from './store.js';

/** Lifecycle events every download passes through. */
export const DOWNLOAD_EVENT = Object.freeze({
  STARTED: 'started',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

/** How long `capture()` waits for a download by default. */
export const DEFAULT_CAPTURE_TIMEOUT = 30000;

/** Monotonic part of a download ID, so IDs are stable and ordered. */
let downloadCounter = 0;

/**
 * Build the identifier a download is reported under.
 *
 * @returns {string} Stable download ID
 */
function nextDownloadId() {
  downloadCounter += 1;
  return `dl-${String(downloadCounter).padStart(6, '0')}`;
}

/**
 * Create the download manager for a browser.
 *
 * @param {Object} options - Manager options
 * @param {string} options.engine - 'playwright' or 'puppeteer'
 * @param {Object} [options.browser] - Browser or persistent context
 * @param {Object} [options.context] - Playwright browser context
 * @param {Object} [options.page] - A page belonging to the browser
 * @param {string} [options.directory] - Absolute path, 'user-downloads' or 'temporary'
 * @param {boolean} [options.persist=true] - Keep files after the browser closes
 * @param {string} [options.conflict='rename'] - 'rename', 'overwrite' or 'error'
 * @param {Function} [options.filename] - Naming callback for every download
 * @param {Function} [options.validate] - Validation for every download
 * @param {Object} [options.log] - Logger
 * @returns {Promise<Object>} Download manager
 */
export async function createDownloadManager(options = {}) {
  const {
    engine = 'playwright',
    browser,
    context = browser,
    page,
    directory,
    persist = true,
    conflict = DOWNLOAD_CONFLICT.RENAME,
    filename,
    validate,
    log,
  } = options;

  // Resolved and probed before a single download can start: a permission
  // problem found afterwards looks like a file that never arrived.
  const root = await prepareDownloadDirectory(
    await resolveDownloadDirectory(directory)
  );

  const emitter = new EventEmitter();
  const artifacts = [];
  const pending = new Map();
  const waiters = new Set();
  const seen = new Set();
  const published = new Set();
  const inFlight = new Set();

  /**
   * Hand a settled artifact to every waiter armed before it started.
   *
   * @param {Object} artifact - Settled artifact
   * @returns {void}
   */
  const settleWaiters = (artifact) => {
    for (const waiter of [...waiters]) {
      if (waiter.accepts(artifact)) {
        waiters.delete(waiter);
        waiter.settle(artifact);
      }
    }
  };

  /**
   * Publish an artifact under its lifecycle event exactly once.
   *
   * @param {Object} artifact - Artifact to publish
   * @param {string} event - Lifecycle event name
   * @returns {void}
   */
  const publish = (artifact, event) => {
    // A download reaches its end once. Both a global listener and an awaited
    // `capture()` read from this same record, so publishing twice would mean
    // one file reported as two.
    if (published.has(artifact)) {
      return;
    }
    published.add(artifact);
    artifact.state = event;
    emitter.emit(event, artifact);
    settleWaiters(artifact);
  };

  const sink = {
    /**
     * Record a download the engine has just announced.
     *
     * @param {Object} start - Engine-reported start details
     * @returns {Object} Artifact record
     */
    started(start) {
      // One engine download can be announced twice - a context listener and a
      // page listener see the same object - so the engine's own handle is the
      // identity, not the order events arrived in.
      if (seen.has(start.engineHandle)) {
        return pending.get(start.engineHandle);
      }
      seen.add(start.engineHandle);

      const artifact = {
        id: nextDownloadId(),
        url: start.url,
        suggestedFilename: start.suggestedFilename,
        state: DOWNLOAD_EVENT.STARTED,
        startedAt: new Date().toISOString(),
        completedAt: null,
        path: null,
        mimeType: start.mimeType ?? null,
        bytes: null,
        checksum: null,
        failure: null,
      };

      pending.set(start.engineHandle, artifact);
      artifacts.push(artifact);
      emitter.emit(DOWNLOAD_EVENT.STARTED, artifact);
      return artifact;
    },

    /**
     * Save a download whose bytes the engine has finished writing.
     *
     * Engine events are fire-and-forget, so the save is registered as in-flight
     * work: otherwise `dispose()` could return while bytes are still being
     * written and leave a `.partial` file as the only trace of the download.
     *
     * @param {Object} artifact - Artifact record
     * @param {Object} source - `{path}` or `{stream}` to read the bytes from
     * @returns {Promise<void>} Resolves once the artifact has been published
     */
    finished(artifact, source) {
      const work = save(artifact, source);
      inFlight.add(work);
      return work.finally(() => inFlight.delete(work));
    },

    /**
     * Record a download that ended without a file.
     *
     * @param {Object} artifact - Artifact record
     * @param {string} kind - {@link DOWNLOAD_FAILURE} classification
     * @param {string} reason - Engine-reported reason, kept verbatim
     * @returns {void}
     */
    failed(artifact, kind, reason) {
      if (!artifact) {
        return;
      }
      artifact.failure = reason;
      publish(
        artifact,
        kind === DOWNLOAD_FAILURE.CANCELLED
          ? DOWNLOAD_EVENT.CANCELLED
          : DOWNLOAD_EVENT.FAILED
      );
    },
  };

  /**
   * Place a finished download's bytes under their final name.
   *
   * @param {Object} artifact - Artifact record
   * @param {Object} source - `{path}` or `{stream}` to read the bytes from
   * @returns {Promise<void>}
   */
  async function save(artifact, source) {
    if (!artifact || artifact.state !== DOWNLOAD_EVENT.STARTED) {
      return;
    }

    try {
      const saved = await saveDownload({
        root,
        source,
        suggestedFilename: artifact.suggestedFilename,
        mimeType: artifact.mimeType,
        conflict: artifact.conflict ?? conflict,
        filename: artifact.filename ?? filename,
        validate: artifact.validate ?? validate,
      });

      Object.assign(artifact, saved, {
        completedAt: new Date().toISOString(),
      });
      publish(artifact, DOWNLOAD_EVENT.COMPLETED);
    } catch (error) {
      artifact.failure = error.message;
      publish(artifact, DOWNLOAD_EVENT.FAILED);
      log?.warn?.(`download ${artifact.id} could not be saved`);
    } finally {
      if (source.removeSource && source.path) {
        await fs.rm(source.path, { force: true });
      }
    }
  }

  /**
   * Wait until every download the manager has seen has been placed.
   *
   * @returns {Promise<void>}
   */
  const idle = async () => {
    while (inFlight.size > 0) {
      await Promise.all([...inFlight]);
    }
  };

  const attached = [];

  if (engine === 'playwright' && context?.on) {
    attached.push(attachPlaywrightSource({ context, sink }));
  }

  // CDP is what makes a *manual* download observable, and it is the only
  // source Puppeteer has. Attaching it is best-effort: a connection without
  // Browser-domain access still gets the Playwright source above.
  let cdpSession;
  try {
    cdpSession = await openBrowserCdpSession({ engine, browser, page });
    if (cdpSession && (engine === 'puppeteer' || options.manualDownloads)) {
      attached.push(await attachCdpSource({ session: cdpSession, root, sink }));
    }
  } catch (error) {
    log?.warn?.(`manual downloads are not observable: ${error.message}`);
  }

  /**
   * Wait for a download, optionally triggering it first.
   *
   * @param {Object} [captureOptions] - Capture options
   * @param {Function} [captureOptions.action] - Action that triggers the download
   * @param {Function|string} [captureOptions.filename] - Name for this download
   * @param {number} [captureOptions.timeout] - Budget for the whole capture
   * @param {Function} [captureOptions.validate] - Validation for this download
   * @returns {Promise<Object>} The settled artifact
   */
  const capture = async (captureOptions = {}) => {
    const {
      action,
      filename: captureFilename,
      timeout = DEFAULT_CAPTURE_TIMEOUT,
      validate: captureValidate,
    } = captureOptions;

    const deadline = createDeadline({ timeout });
    const armedAt = artifacts.length;

    let settle;
    const settled = new Promise((resolve) => {
      settle = resolve;
    });

    const waiter = {
      /**
       * Accept the first download that started after this waiter was armed.
       *
       * @param {Object} artifact - Settled artifact
       * @returns {boolean} Whether this waiter claims it
       */
      accepts: (artifact) => artifacts.indexOf(artifact) >= armedAt,
      settle,
    };
    waiters.add(waiter);

    // Per-download naming and validation are attached to whichever download
    // this waiter claims, so they cannot leak onto an unrelated one.
    const claim = (artifact) => {
      if (captureFilename !== undefined) {
        artifact.filename =
          typeof captureFilename === 'function'
            ? captureFilename
            : () => captureFilename;
      }
      if (captureValidate) {
        artifact.validate = captureValidate;
      }
    };

    const onStarted = (artifact) => {
      if (waiter.accepts(artifact)) {
        claim(artifact);
      }
    };
    emitter.on(DOWNLOAD_EVENT.STARTED, onStarted);

    // Both the waiter and the naming rules are armed before the action runs.
    // A download can start, finish and be saved inside `action()` - attaching
    // them afterwards would save the file under the wrong name and skip the
    // caller's validation entirely.
    try {
      if (action) {
        await action();
      }
    } catch (error) {
      waiters.delete(waiter);
      emitter.off(DOWNLOAD_EVENT.STARTED, onStarted);
      throw error;
    }

    let timer;
    const expiry = new Promise((_resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `no download completed within ${timeout}ms of the triggering action`
            )
          ),
        Math.max(1, deadline.remainingMs())
      );
    });

    try {
      const artifact = await Promise.race([settled, expiry]);
      if (artifact.state !== DOWNLOAD_EVENT.COMPLETED) {
        throw new Error(
          `download ${artifact.id} ${artifact.state}: ${artifact.failure}`
        );
      }
      return artifact;
    } finally {
      clearTimeout(timer);
      waiters.delete(waiter);
      emitter.off(DOWNLOAD_EVENT.STARTED, onStarted);
    }
  };

  return {
    directory: root,
    persist,
    conflict,
    /**
     * List every download seen in this session.
     *
     * @returns {Object[]} Artifacts in the order they started
     */
    list: () => [...artifacts],
    capture,
    idle,
    on: (event, listener) => emitter.on(event, listener),
    once: (event, listener) => emitter.once(event, listener),
    off: (event, listener) => emitter.off(event, listener),
    /**
     * Stop observing downloads.
     *
     * Saved files are untouched: persistence is the point of the manager, so
     * detaching must never be the thing that removes a user's file.
     *
     * @returns {Promise<void>}
     */
    dispose: async () => {
      // A download still being written is finished first: detaching must not
      // be the reason a file only ever exists under its `.partial` name.
      await idle();
      for (const handle of attached) {
        await handle.detach();
      }
      await cdpSession?.detach?.().catch?.(() => {});
      emitter.removeAllListeners();
    },
  };
}

export { classifyFailure, DOWNLOAD_CONFLICT, DOWNLOAD_FAILURE };
