/**
 * The trace recorder (issue #87).
 *
 * A consumer starts a recorder, names checkpoints and stops it. Nothing in
 * that path requires the raw Playwright or Puppeteer page: the recorder is
 * the thing that knows how each engine reports a console message or a failed
 * request, so every caller does not have to.
 */

import {
  captureSnapshotInPage,
  drainMutationsInPage,
  installMutationRecorderInPage,
  RECORDER_GLOBAL,
} from './page-capture.js';
import { openTraceBundle } from './bundle.js';
import { attachTimelineObservers } from './observers.js';
import {
  normalizePrivacyOptions,
  redactUrl,
  redactValue,
  REDACTED,
} from './redaction.js';
import {
  createManifest,
  DEFAULT_CAPTURE_TIMEOUT,
  TRACE_DROP_REASON,
  TRACE_EVENT,
  TRACE_EVENT_SOURCES,
  TRACE_MODE,
  TRACE_OUTCOME,
} from './schema.js';

/** DOM capture defaults: what a checkpoint holds unless the caller narrows it. */
const DEFAULT_DOM_OPTIONS = Object.freeze({
  html: true,
  liveControlState: true,
  mutations: false,
  openShadowRoots: true,
});

function normalizeMode(mode) {
  const values = Object.values(TRACE_MODE);
  if (!values.includes(mode)) {
    throw new Error(`trace mode must be one of ${values.join(', ')}`);
  }
  return mode;
}

function normalizeEvents(events) {
  if (events === false) {
    return [];
  }
  if (events === undefined || events === true) {
    return [...TRACE_EVENT_SOURCES];
  }
  if (!Array.isArray(events)) {
    throw new Error('trace events must be an array of event names');
  }
  for (const name of events) {
    if (!TRACE_EVENT_SOURCES.includes(name)) {
      throw new Error(
        `unknown trace event source "${name}"; expected one of ${TRACE_EVENT_SOURCES.join(', ')}`
      );
    }
  }
  return [...new Set(events)];
}

/**
 * Run a capture with its own deadline.
 *
 * A page that stopped answering must cost the trace one record, not the run.
 *
 * @param {Promise} work - The capture
 * @param {number} timeoutMs - Budget
 * @param {string} what - Name used in the timeout message
 * @returns {Promise<*>} The capture's result
 */
async function withDeadline(work, timeoutMs, what) {
  if (!timeoutMs) {
    return work;
  }
  let timer;
  try {
    return await Promise.race([
      work,
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${what} timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Start recording a session.
 *
 * @param {Object} options - Recorder options, see `commander.startTrace()`
 * @returns {Promise<Object>} The running trace
 */
export async function startTrace(options = {}) {
  const {
    commander,
    page = commander?.page,
    output,
    mode = TRACE_MODE.CHECKPOINTS,
    screenshots = 'checkpoints',
    dom = {},
    events,
    privacy = {},
    limits = {},
    strict = false,
    captureTimeoutMs = DEFAULT_CAPTURE_TIMEOUT,
    commanderVersion = null,
    log = commander?.log,
    now = () => Date.now(),
  } = options;

  if (!page) {
    throw new Error('startTrace requires a page or a commander');
  }

  const recorderMode = normalizeMode(mode);
  const domOptions = { ...DEFAULT_DOM_OPTIONS, ...dom };
  if (recorderMode === TRACE_MODE.CONTINUOUS && dom.mutations !== false) {
    domOptions.mutations = true;
  }
  const eventSources = normalizeEvents(events);
  const privacyOptions = normalizePrivacyOptions(privacy);
  const engine = commander?.engine ?? null;

  const bundle = await openTraceBundle({ output, limits, strict, now });
  const startedAt = new Date(now()).toISOString();

  let stopped = false;
  let checkpointIndex = 0;
  const checkpoints = [];

  const note = (message) => log?.debug?.(`[trace] ${message}`);

  /**
   * Record an event on the shared timeline.
   *
   * @param {string} kind - One of TRACE_EVENT
   * @param {Object} [payload] - Event fields, redacted before writing
   * @returns {Promise<Object|null>} The written event
   */
  async function record(kind, payload = {}) {
    if (stopped && kind !== TRACE_EVENT.TRACE_STOP) {
      return null;
    }
    return await bundle.appendEvent({
      kind,
      ...redactValue(payload, privacyOptions),
    });
  }

  async function evaluateInPage(fn, argument) {
    // Both engines take `(fn, arg)`; the commander's own evaluate already
    // normalizes the difference, and is used when it is available.
    if (commander?.evaluate) {
      return await commander.evaluate(fn, argument);
    }
    return await page.evaluate(fn, argument);
  }

  async function installMutationRecorder() {
    if (!domOptions.mutations) {
      return;
    }
    try {
      await evaluateInPage(installMutationRecorderInPage, {
        globalName: RECORDER_GLOBAL,
        redactSelectors: privacyOptions.redactSelectors,
        redacted: REDACTED,
        maxQueued: limits.maxQueuedMutations ?? 5000,
      });
    } catch (error) {
      await bundle.drop({
        reason: TRACE_DROP_REASON.CAPTURE_FAILED,
        member: 'mutation-recorder',
        detail: error.message,
      });
    }
  }

  async function drainMutations(index) {
    if (!domOptions.mutations) {
      return null;
    }
    try {
      const drained = await withDeadline(
        evaluateInPage(drainMutationsInPage, RECORDER_GLOBAL),
        captureTimeoutMs,
        'trace mutation drain'
      );
      if (drained?.dropped) {
        await bundle.drop({
          reason: TRACE_DROP_REASON.SIZE_LIMIT,
          member: 'mutations',
          detail: `${drained.dropped} records over the in-page queue limit`,
        });
      }
      const member = await bundle.writeMutations(index, drained?.batches ?? []);
      if (member) {
        await record(TRACE_EVENT.MUTATIONS, {
          member,
          batches: drained.batches.length,
          checkpoint: index,
        });
      }
      return member;
    } catch (error) {
      await bundle.drop({
        reason: TRACE_DROP_REASON.CAPTURE_FAILED,
        member: 'mutations',
        detail: error.message,
      });
      return null;
    }
  }

  async function screenshot(reason) {
    const wanted =
      screenshots === true ||
      screenshots === 'checkpoints' ||
      (screenshots === 'only-on-failure' && reason === 'failure');
    if (!wanted || typeof page.screenshot !== 'function') {
      return null;
    }
    try {
      const shot = await withDeadline(
        page.screenshot({ type: 'png' }),
        captureTimeoutMs,
        'trace screenshot'
      );
      return Buffer.isBuffer(shot) ? shot : Buffer.from(shot);
    } catch (error) {
      await bundle.drop({
        reason: TRACE_DROP_REASON.CAPTURE_FAILED,
        member: 'screenshot',
        detail: error.message,
      });
      return null;
    }
  }

  /**
   * Capture a named checkpoint.
   *
   * @param {string} name - What this moment is
   * @param {Object} [checkpointOptions] - `{actor, reason, screenshots}`
   * @returns {Promise<Object|null>} `{index, name, members}`
   */
  async function checkpoint(name, checkpointOptions = {}) {
    if (stopped) {
      throw new Error('this trace has already been stopped');
    }

    const { actor = 'automation', reason = 'checkpoint' } = checkpointOptions;
    const index = ++checkpointIndex;

    // Mutations are drained first so the batches belong to the interval that
    // ended here, not to the one that starts now.
    await drainMutations(index - 1 > 0 ? index - 1 : 0);

    let captured = null;
    try {
      captured = await withDeadline(
        evaluateInPage(captureSnapshotInPage, {
          redactSelectors: privacyOptions.redactSelectors,
          redactAttributes: privacyOptions.redactAttributes,
          redacted: REDACTED,
          html: domOptions.html,
          liveControlState: domOptions.liveControlState,
          openShadowRoots: domOptions.openShadowRoots,
          maxHtmlBytes: limits.maxHtmlBytes ?? 0,
        }),
        captureTimeoutMs,
        'trace checkpoint capture'
      );
    } catch (error) {
      await bundle.drop({
        reason: /closed/i.test(error.message)
          ? TRACE_DROP_REASON.PAGE_CLOSED
          : TRACE_DROP_REASON.CAPTURE_FAILED,
        member: `checkpoints/${index}`,
        detail: error.message,
      });
    }

    const shot = await screenshot(reason);
    const state = captured?.state
      ? redactValue(captured.state, privacyOptions)
      : null;

    const members = await bundle.writeCheckpoint({
      index,
      html: captured?.html ?? undefined,
      state: state ? { ...state, name, actor, reason } : undefined,
      screenshot: shot ?? undefined,
    });

    const entry = {
      index,
      name,
      actor,
      reason,
      url: state ? redactUrl(state.url, privacyOptions) : null,
      truncated: Boolean(captured?.truncated),
      members,
    };
    checkpoints.push(entry);
    await record(TRACE_EVENT.CHECKPOINT, entry);

    // A navigation replaces the document and with it the observer, so the
    // recorder is reinstalled at every checkpoint rather than only at start.
    await installMutationRecorder();

    return entry;
  }

  const detachers = attachTimelineObservers({
    commander,
    page,
    eventSources,
    record,
    note,
  });

  await record(TRACE_EVENT.TRACE_START, {
    mode: recorderMode,
    engine,
    dom: domOptions,
    events: eventSources,
  });
  await installMutationRecorder();

  /**
   * Stop recording and write the manifest.
   *
   * @param {Object} [stopOptions] - `{outcome, discard, error}`
   * @returns {Promise<Object>} `{path, manifest, checkpoints}`
   */
  async function stop(stopOptions = {}) {
    if (stopped) {
      return stopped;
    }
    const { discard = false, error = null } = stopOptions;

    await drainMutations(checkpointIndex);
    if (error) {
      await record(TRACE_EVENT.PAGE_ERROR, {
        message: error.message ?? String(error),
        stack: error.stack ?? null,
        fatal: true,
      });
    }
    await record(TRACE_EVENT.TRACE_STOP, { discarded: discard });
    stopped = true;

    for (const detach of detachers.reverse()) {
      try {
        await detach();
      } catch (detachError) {
        note(`could not detach a listener: ${detachError.message}`);
      }
    }

    const manifest = await bundle.close(
      createManifest({
        mode: recorderMode,
        startedAt,
        stoppedAt: new Date(now()).toISOString(),
        outcome: TRACE_OUTCOME.COMPLETE,
        commanderVersion,
        engine,
        dom: domOptions,
        events: eventSources,
        privacy: {
          redactSelectors: privacyOptions.redactSelectors,
          redactAttributes: privacyOptions.redactAttributes,
          redactQueryParams: privacyOptions.redactQueryParams,
          hasCallback: Boolean(privacyOptions.redact),
        },
        limits,
      })
    );

    const result = {
      path: bundle.root,
      manifest,
      checkpoints: [...checkpoints],
      problems: [...bundle.problems],
    };
    stopped = result;

    if (discard) {
      const fs = await import('node:fs/promises');
      await fs.rm(bundle.root, { recursive: true, force: true });
      result.discarded = true;
    }

    return result;
  }

  return {
    path: bundle.root,
    mode: recorderMode,
    checkpoint,
    /**
     * Record an event a caller cares about on the same timeline.
     *
     * @param {string} name - What happened
     * @param {Object} [data] - Details, redacted before writing
     * @returns {Promise<Object|null>} The written event
     */
    event: (name, data = {}) =>
      record(TRACE_EVENT.INTERACTION, {
        action: name,
        actor: 'caller',
        ...data,
      }),
    stop,
    get stopped() {
      return Boolean(stopped);
    },
    get checkpoints() {
      return [...checkpoints];
    },
  };
}
