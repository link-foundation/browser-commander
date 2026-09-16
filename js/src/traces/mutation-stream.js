/**
 * The continuous half of a trace (issue #93).
 *
 * A checkpoint is a photograph; this is the film between two of them. Keeping
 * it here rather than inside the recorder is what lets it answer the three
 * questions issue #93 said it could not: what happened while a new document was
 * loading, what happened inside an iframe, and what happened to state the DOM
 * never mentions.
 *
 * The in-page half lives in `page-capture.js` and is installed twice over: once
 * into every document that already exists, and once as an init script so every
 * document created from now on is observed before its own code runs.
 */

import { withDeadline } from './deadline.js';
import { framesOf, installInitScript } from './init-script.js';
import {
  drainMutationsInPage,
  installMutationRecorderInPage,
  RECORDER_GLOBAL,
  stopMutationRecorderInPage,
} from './page-capture.js';
import { REDACTED } from './redaction.js';
import { TRACE_DROP_REASON, TRACE_EVENT } from './schema.js';

/** In-page records kept before the recorder starts counting drops instead. */
export const DEFAULT_MAX_QUEUED_MUTATIONS = 5000;

/**
 * Build the recorder's continuous stream.
 *
 * @param {Object} options - Collaborators the stream needs
 * @param {Object} options.page - The page being traced
 * @param {Object} options.bundle - Open trace bundle
 * @param {Function} options.record - Writes one timeline record
 * @param {Object} options.identity - Trace identity, see `identity.js`
 * @param {Function} options.note - Reports something that could not be done
 * @param {Object} options.domOptions - Resolved `dom` options
 * @param {Object} options.privacyOptions - Resolved privacy options
 * @param {Object} options.limits - Resolved limits
 * @param {number} options.captureTimeoutMs - Budget for one drain
 * @param {Function} options.evaluateInPage - Fallback for a page without frames
 * @returns {Object} `{install, installPersistent, drain, stop}`
 */
export function createMutationStream(options) {
  const {
    page,
    bundle,
    record,
    identity,
    note,
    domOptions,
    privacyOptions,
    limits,
    captureTimeoutMs,
    evaluateInPage,
  } = options;

  const enabled = Boolean(domOptions.mutations);

  /** What the in-page recorder is built with, wherever it is installed. */
  const recorderOptions = {
    globalName: RECORDER_GLOBAL,
    redactSelectors: privacyOptions.redactSelectors,
    redacted: REDACTED,
    maxQueued: limits.maxQueuedMutations ?? DEFAULT_MAX_QUEUED_MUTATIONS,
    liveState: domOptions.liveState !== false,
  };

  /**
   * Run something in every frame of the page.
   *
   * An iframe is a separate document with a separate observer, so a trace that
   * only ever spoke to the main frame recorded nothing that happened inside
   * one. A frame that goes away mid-call is expected rather than a failure: a
   * frame that has already gone has nothing left to report.
   *
   * @param {Function} fn - The function to evaluate
   * @param {*} argument - Its argument
   * @returns {Promise<Array>} One result per frame that answered
   */
  async function evaluateInFrames(fn, argument) {
    const frames = framesOf(page);
    if (frames.length === 0) {
      return [await evaluateInPage(fn, argument)];
    }
    const results = await Promise.all(
      frames.map(async (frame) => {
        try {
          return await frame.evaluate(fn, argument);
        } catch {
          return null;
        }
      })
    );
    return results.filter((result) => result !== null);
  }

  async function dropped(
    member,
    error,
    reason = TRACE_DROP_REASON.CAPTURE_FAILED
  ) {
    await bundle.drop({
      reason,
      member,
      detail: error.message ?? String(error),
    });
  }

  /**
   * Install the recorder into the documents that already exist.
   *
   * New documents are covered by the init script; this covers the one the trace
   * started in, and any frame that was already open when it did.
   *
   * @returns {Promise<void>} Resolves once every frame has been asked
   */
  async function install() {
    if (!enabled) {
      return;
    }
    try {
      await evaluateInFrames(installMutationRecorderInPage, recorderOptions);
    } catch (error) {
      await dropped('mutation-recorder', error);
    }
  }

  /**
   * Register the recorder to run before the code of every future document.
   *
   * This is what closes the gap between a navigation and the next checkpoint:
   * without it a new document's own scripts run unobserved, and everything they
   * build looks, on replay, like it had been there all along.
   *
   * @returns {Promise<Function|null>} Detach, when the engine offers one
   */
  async function installPersistent() {
    if (!enabled) {
      return null;
    }
    try {
      return await installInitScript({
        page,
        fn: installMutationRecorderInPage,
        arg: recorderOptions,
        note,
      });
    } catch (error) {
      await dropped('mutation-recorder-init', error);
      return null;
    }
  }

  /**
   * Take everything every frame has queued and write it as one interval.
   *
   * @param {number} index - Checkpoint the interval ends at
   * @returns {Promise<string|null>} The member written, when there was anything
   */
  async function drain(index) {
    if (!enabled) {
      return null;
    }
    try {
      const drained = await withDeadline(
        evaluateInFrames(drainMutationsInPage, RECORDER_GLOBAL),
        captureTimeoutMs,
        'trace mutation drain'
      );

      const batches = [];
      let over = 0;
      for (const frame of drained) {
        over += frame?.dropped ?? 0;
        for (const batch of frame?.batches ?? []) {
          // The identity of the trace comes from here and the identity of the
          // document comes from inside it: a frame handle is not something an
          // NDJSON record can hold, so each document names itself.
          batches.push({ ...identity.owner(), ...batch });
        }
      }

      if (over) {
        await dropped(
          'mutations',
          new Error(`${over} records over the in-page queue limit`),
          TRACE_DROP_REASON.SIZE_LIMIT
        );
      }

      // Frames are drained in parallel, so the batches come back grouped by
      // frame; one ordered file is what a replay reads.
      batches.sort((left, right) => (left.at ?? 0) - (right.at ?? 0));

      const member = await bundle.writeMutations(index, batches);
      if (member) {
        await record(TRACE_EVENT.MUTATIONS, {
          member,
          batches: batches.length,
          checkpoint: index,
          frames: drained.length,
        });
      }
      return member;
    } catch (error) {
      await dropped('mutations', error);
      return null;
    }
  }

  /**
   * Switch the recorder off in every document that has one.
   *
   * A recorder left observing would keep queueing into a queue nobody drains.
   *
   * @returns {Promise<void>} Resolves once every frame has been asked
   */
  async function stop() {
    if (!enabled) {
      return;
    }
    try {
      await evaluateInFrames(stopMutationRecorderInPage, RECORDER_GLOBAL);
    } catch (error) {
      note?.(`could not stop the in-page recorder: ${error.message}`);
    }
  }

  return { install, installPersistent, drain, stop };
}
