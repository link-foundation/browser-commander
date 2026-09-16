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
 * Find the object Playwright emits its `download` event on.
 *
 * A download is a *context*-level event. `launchBrowser()` hands back a
 * persistent context, so the browser handle works there by accident; a
 * `Browser` returned by `connectBrowser()` never emits `download` at all.
 * Taking the page's context is what makes an attached browser behave exactly
 * like a launched one.
 *
 * @param {Object} options - Handles the caller supplied
 * @param {Object} [options.browser] - Browser or persistent context
 * @param {Object} [options.page] - A page belonging to the browser
 * @returns {Object|undefined} The context downloads are observed on
 */
function playwrightDownloadContext({ browser, page }) {
  const fromPage =
    typeof page?.context === 'function' ? page.context() : undefined;
  return fromPage ?? browser;
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
 * @param {number} [options.stagingTimeout] - How long a completed download has
 *   to become readable on disk before it is reported as failed (issue #92)
 * @param {number} [options.stagingPollInterval] - Milliseconds between readings
 * @param {Object} [options.log] - Logger
 * @returns {Promise<Object>} Download manager
 */
export async function createDownloadManager(options = {}) {
  const {
    engine = 'playwright',
    browser,
    context: explicitContext,
    page,
    directory,
    persist = true,
    conflict = DOWNLOAD_CONFLICT.RENAME,
    filename,
    validate,
    stagingTimeout,
    stagingPollInterval,
    log,
  } = options;

  const context =
    explicitContext ??
    (engine === 'playwright'
      ? playwrightDownloadContext({ browser, page })
      : browser);

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
     * Register work a download is not finished without.
     *
     * Engine events are fire-and-forget, so anything a source starts in one -
     * saving the bytes, or waiting for them to land on disk at all - has to be
     * registered here: otherwise `dispose()` could return while a download is
     * still in flight and leave a `.partial` file as its only trace.
     *
     * @param {Promise} work - Work to wait for in `idle()` and `dispose()`
     * @returns {Promise<void>} The same work, tracked
     */
    track(work) {
      inFlight.add(work);
      return work.finally(() => inFlight.delete(work));
    },

    /**
     * Save a download whose bytes the engine has finished writing.
     *
     * @param {Object} artifact - Artifact record
     * @param {Object} source - `{path}` or `{stream}` to read the bytes from
     * @returns {Promise<void>} Resolves once the artifact has been published
     */
    finished(artifact, source) {
      return sink.track(save(artifact, source));
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

  // CDP is what makes a download a *person* started observable, and it is the
  // only source Puppeteer has, so it is tried first. It is also exclusive:
  // `Browser.setDownloadBehavior` takes the bytes away from Playwright's own
  // download handling, so attaching both sources would mean one download
  // reported twice and a Playwright `path()` pointing at a file that was
  // never written.
  let cdpSession;
  try {
    cdpSession = await openBrowserCdpSession({ engine, browser, page });
    if (cdpSession) {
      attached.push(
        await attachCdpSource({
          session: cdpSession,
          root,
          sink,
          stagingTimeout,
          stagingPollInterval,
        })
      );
    }
  } catch (error) {
    cdpSession = undefined;
    log?.warn?.(`manual downloads are not observable: ${error.message}`);
  }

  // Without Browser-domain access - an attached browser that refuses it, or a
  // context with no page to borrow a session from - Playwright's own event
  // still covers every automated download.
  if (attached.length === 0 && engine === 'playwright' && context?.on) {
    attached.push(attachPlaywrightSource({ context, sink }));
  }

  if (attached.length === 0) {
    log?.warn?.(
      'no download source could be attached: downloads will not be managed'
    );
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
