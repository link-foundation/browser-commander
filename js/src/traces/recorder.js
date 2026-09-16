/**
 * The trace recorder (issue #87).
 *
 * A consumer starts a recorder, names checkpoints and stops it. Nothing in
 * that path requires the raw Playwright or Puppeteer page: the recorder is
 * the thing that knows how each engine reports a console message or a failed
 * request, so every caller does not have to.
 */

import { captureSnapshotInPage } from './page-capture.js';
import { openTraceBundle } from './bundle.js';
import { openTraceLinks } from './links.js';
import { createTraceIdentity } from './identity.js';
import { withDeadline } from './deadline.js';
import { createMutationStream } from './mutation-stream.js';
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
  TRACE_CHECKPOINT_REASON,
  TRACE_DROP_REASON,
  TRACE_EVENT,
  TRACE_EVENT_SOURCES,
  TRACE_MODE,
  TRACE_OUTCOME,
  TRACE_SCHEMA_VERSION,
} from './schema.js';

/** DOM capture defaults: what a checkpoint holds unless the caller narrows it. */
const DEFAULT_DOM_OPTIONS = Object.freeze({
  html: true,
  liveControlState: true,
  /**
   * Record what typing, checking, selecting, focus and scroll did, as it
   * happens (issue #93). Reading it only at checkpoints meant a replay could
   * show an empty field a moment after the user finished filling it in.
   */
  liveState: true,
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
    initialCheckpoint,
    screenshots = 'checkpoints',
    dom = {},
    events,
    privacy = {},
    limits = {},
    links = null,
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
  const identity = createTraceIdentity({ page });

  // A continuous trace records changes, and a change is only meaningful against
  // something. Taking the base snapshot automatically is the safe default,
  // because a trace that starts mid-air replays as a blank page (issue #93); a
  // checkpoints-only trace is a list of moments the caller named, so nothing is
  // added to it uninvited. Passing a string names the base checkpoint.
  const baseCheckpoint =
    initialCheckpoint ?? recorderMode === TRACE_MODE.CONTINUOUS;
  const baseCheckpointName =
    typeof baseCheckpoint === 'string' ? baseCheckpoint : 'initial';

  // The Links Notation export is a second view of the same records, written
  // as they are recorded (issue #94), so a run that is killed leaves a
  // readable export of everything that had happened. The bundle stays
  // authoritative: nothing is written here that is not written there first.
  let linksSink = null;
  const bundle = await openTraceBundle({
    output,
    limits,
    strict,
    now,
    onEvent: (event) => linksSink?.event(event),
  });
  const startedAt = new Date(now()).toISOString();

  if (links) {
    if (typeof links.output !== 'string' || links.output === '') {
      throw new Error('trace links require an output path');
    }
    linksSink = await openTraceLinks({
      output: links.output,
      include: links.include,
      bundlePath: bundle.root,
      schemaVersion: TRACE_SCHEMA_VERSION,
      mode: recorderMode,
      engine,
      startedAt,
      commanderVersion,
    });
  }

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
      // Who this happened to comes first so a payload that knows better - a
      // drain that names the frame it came from, say - can say so.
      ...identity.owner(),
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

  const mutations = createMutationStream({
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
  });

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
    await mutations.drain(index - 1 > 0 ? index - 1 : 0);

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

    // The init script covers every document created from here on; this covers
    // a frame that was attached without one, which is cheap because installing
    // over a recorder that is already observing does nothing.
    await mutations.install();

    return entry;
  }

  const detachers = attachTimelineObservers({
    commander,
    page,
    eventSources,
    record,
    note,
    identity,
  });

  // Registered before the first record, so a navigation that starts in the same
  // tick as the trace does is still recorded from its first mutation.
  const detachInitScript = await mutations.installPersistent();
  if (detachInitScript) {
    detachers.push(detachInitScript);
  }

  await record(TRACE_EVENT.TRACE_START, {
    mode: recorderMode,
    engine,
    dom: domOptions,
    events: eventSources,
    initialCheckpoint: Boolean(baseCheckpoint),
  });
  await mutations.install();

  if (baseCheckpoint) {
    await checkpoint(baseCheckpointName, {
      actor: 'recorder',
      reason: TRACE_CHECKPOINT_REASON.INITIAL,
    });
  }

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

    await mutations.drain(checkpointIndex);
    if (error) {
      await record(TRACE_EVENT.PAGE_ERROR, {
        message: error.message ?? String(error),
        stack: error.stack ?? null,
        fatal: true,
      });
    }
    await record(TRACE_EVENT.TRACE_STOP, { discarded: discard });
    stopped = true;

    // The documents that exist stop observing here; the engine's init-script
    // registration is removed with the detachers below.
    await mutations.stop();

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
        replay: {
          checkpoints: true,
          mutations: Boolean(domOptions.mutations),
          childListPositions: Boolean(domOptions.mutations),
          liveState:
            Boolean(domOptions.mutations) && domOptions.liveState !== false,
          identifiers: true,
        },
        privacy: {
          redactSelectors: privacyOptions.redactSelectors,
          redactAttributes: privacyOptions.redactAttributes,
          redactQueryParams: privacyOptions.redactQueryParams,
          hasCallback: Boolean(privacyOptions.redact),
        },
        limits,
      })
    );

    // Closed after the manifest, because the closing link reports the outcome
    // the manifest settled on, and the control diffs are read back out of the
    // finished bundle rather than kept in memory for the length of a run.
    if (linksSink) {
      await linksSink.close({ manifest, bundlePath: bundle.root });
    }

    const result = {
      path: bundle.root,
      manifest,
      checkpoints: [...checkpoints],
      problems: [...bundle.problems, ...(linksSink?.problems ?? [])],
      links: linksSink?.path ?? null,
    };
    stopped = result;

    if (discard) {
      const fs = await import('node:fs/promises');
      await fs.rm(bundle.root, { recursive: true, force: true });
      // An export of a bundle that no longer exists points at nothing.
      await linksSink?.discard();
      result.discarded = true;
    }

    return result;
  }

  return {
    path: bundle.root,
    links: linksSink?.path ?? null,
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
