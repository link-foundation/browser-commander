/**
 * Waiting for a staged download to actually be on disk (issue #92).
 *
 * `Browser.downloadProgress` with `state: "completed"` is the browser saying it
 * has stopped downloading, not the filesystem saying the bytes are there under
 * the name we are about to open. Chromium writes into `<guid>.crdownload` and
 * renames it, and the event can reach us before that rename is visible - which
 * is how a completed download became
 * `ENOENT: no such file or directory, open '<root>/.browser-commander-staging/<guid>'`.
 *
 * This module turns "the browser said completed" into "the file is readable and
 * has stopped growing", within a bounded budget. Running out of that budget is
 * an explicit failure, never a silent success: issue #88's rule that "a
 * download UI entry is not completion evidence" is exactly the rule being
 * applied one level lower down.
 */

import fs from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

import { createDeadline } from '../core/readiness.js';

/** How long to wait for a completed download's bytes to appear, by default. */
export const DEFAULT_STAGING_TIMEOUT = 10000;

/** How often the staged file is looked at while waiting. */
export const DEFAULT_STAGING_POLL_INTERVAL = 25;

/** Suffixes Chromium uses for a file it is still writing. */
export const STAGING_IN_PROGRESS_SUFFIXES = Object.freeze([
  '.crdownload',
  '.partial',
]);

/**
 * Look at a staged file once.
 *
 * @param {string} filePath - Path the engine staged the download under
 * @param {string[]} suffixes - Suffixes that mark a file still being written
 * @returns {Promise<{size: number|null, reason: string|null}>} What was seen
 */
async function observeStagedFile(filePath, suffixes) {
  for (const suffix of suffixes) {
    try {
      await fs.stat(`${filePath}${suffix}`);
      return { size: null, reason: `a ${suffix} file is still being written` };
    } catch {
      // Absent is what we want: the rename to the final staged name has
      // already happened, or Chromium never used this suffix at all.
    }
  }

  let handle;
  try {
    // Opening rather than stat'ing is deliberate: "readable" is the property
    // `saveDownload()` needs, and a name that resolves is not the same thing
    // as a file this process is allowed to read.
    handle = await fs.open(filePath, 'r');
  } catch (error) {
    return {
      size: null,
      reason:
        error.code === 'ENOENT'
          ? 'the file has not appeared yet'
          : `the file could not be opened: ${error.message}`,
    };
  }

  try {
    const stats = await handle.stat();
    return { size: stats.size, reason: null };
  } finally {
    await handle.close();
  }
}

/**
 * Wait until a staged download is readable and has stopped growing.
 *
 * Stability is decided by two consecutive readings of the same size, the same
 * evidence the Selenium directory watcher uses: a file that merely exists is
 * not evidence that its last byte was written.
 *
 * @param {Object} options - Wait options
 * @param {string} options.path - Path the engine staged the download under
 * @param {number} [options.timeout] - Total budget in milliseconds
 * @param {number} [options.interval] - Milliseconds between readings
 * @param {string[]} [options.inProgressSuffixes] - Suffixes of a partial file
 * @returns {Promise<{ready: boolean, bytes: number|null, reason: string|null, waitedMs: number}>} Outcome
 */
export async function waitForStagedFile(options = {}) {
  const {
    path: filePath,
    timeout = DEFAULT_STAGING_TIMEOUT,
    interval = DEFAULT_STAGING_POLL_INTERVAL,
    inProgressSuffixes = STAGING_IN_PROGRESS_SUFFIXES,
  } = options;

  const deadline = createDeadline({ timeout });
  let previousSize;
  // Always set by the reading below before the deadline can be checked.
  let reason;

  for (;;) {
    const seen = await observeStagedFile(filePath, inProgressSuffixes);
    if (seen.reason !== null) {
      reason = seen.reason;
      // A file that vanished has to prove itself stable again from scratch.
      previousSize = undefined;
    } else if (seen.size === previousSize) {
      return {
        ready: true,
        bytes: seen.size,
        reason: null,
        waitedMs: deadline.elapsedMs(),
      };
    } else {
      previousSize = seen.size;
      reason = `the file was still growing at ${seen.size} bytes`;
    }

    const remaining = deadline.remainingMs();
    if (remaining === 0) {
      return {
        ready: false,
        bytes: null,
        reason,
        waitedMs: deadline.elapsedMs(),
      };
    }
    await delay(Math.min(interval, remaining));
  }
}

/**
 * The failure text a staged download that never materialized is reported under.
 *
 * @param {Object} options - Failure details
 * @param {string} options.path - Path the engine staged the download under
 * @param {number} options.timeout - Budget that was exhausted
 * @param {string} options.reason - What the last reading saw
 * @returns {string} Message kept verbatim on the artifact
 */
export function describeStagingTimeout({ path: filePath, timeout, reason }) {
  return `the browser reported the download as completed, but ${filePath} was not readable within ${timeout}ms: ${reason}`;
}
