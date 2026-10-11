import { abortTraceStart } from './start-cleanup.js';
import { createTraceStop } from './stop.js';
import { openRollingBundle } from './rolling-bundle.js';
/**
 * The trace recorder (issue #87).
 *
 * A consumer starts a recorder, names checkpoints and stops it. Nothing in
 * that path requires the raw Playwright or Puppeteer page: the recorder is
 * the thing that knows how each engine reports a console message or a failed
 * request, so every caller does not have to.
 */

import { createCheckpointRecorder } from './checkpoints.js';
import { openTraceBundle } from './bundle.js';
import { openTraceLinks } from './links.js';
import { createTraceIdentity } from './identity.js';
import { withDeadline } from './deadline.js';
import { createMutationStream } from './mutation-stream.js';
import { attachTimelineObservers } from './observers.js';
import { attachNetwork, validateNetworkOptions } from './network.js';
import { startRecording } from '../capture/recording.js';
import { normalizePrivacyOptions, redactValue } from './redaction.js';
import {
  DEFAULT_CAPTURE_TIMEOUT,
  TRACE_CHECKPOINT_REASON,
  TRACE_DROP_REASON,
  TRACE_EVENT,
  TRACE_EVENT_SOURCES,
  TRACE_MODE,
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
 * Reject a malformed side export before the bundle opens any file handles.
 *
 * @param {Object|null} links - Optional Links Notation export options
 * @returns {void}
 */
function validateLinksOptions(links) {
  if (links && (typeof links.output !== 'string' || links.output === '')) {
    throw new Error('trace links require an output path');
  }
}

/**
 * Start recording a session.
 *
 * @param {Object} options - Recorder options, see `commander.startTrace()`
 * @returns {Promise<Object>} The running trace
 */
function normalizeTraceOptions(options) {
  return {
    ...options,
    page: options.page ?? options.commander?.page,
    mode: options.mode ?? TRACE_MODE.CHECKPOINTS,
    screenshots: options.screenshots ?? 'checkpoints',
    dom: options.dom ?? {},
    privacy: options.privacy ?? {},
    limits: options.limits ?? {},
    links: options.links ?? null,
    network: options.network ?? false,
    strict: options.strict ?? false,
    captureTimeoutMs: options.captureTimeoutMs ?? DEFAULT_CAPTURE_TIMEOUT,
    commanderVersion: options.commanderVersion ?? null,
    log: options.log ?? options.commander?.log,
    now: options.now ?? (() => Date.now()),
  };
}

export async function startTrace(options = {}) {
  if (options.limits?.rotate) {
    const { startRollingTrace } = await import('./rolling.js');
    return startRollingTrace(options, startTrace);
  }
  requireTraceSupport(options);
  const {
    commander,
    page,
    output,
    mode,
    initialCheckpoint,
    screenshots,
    dom,
    events,
    privacy,
    limits,
    links,
    network,
    strict,
    captureTimeoutMs,
    commanderVersion,
    log,
    now,
    monotonic,
  } = normalizeTraceOptions(options);

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
  // Validate the optional side export before opening the authoritative bundle.
  // Otherwise a rejected start (for example `links: {}`) strands the bundle's
  // events handle because no running trace is returned for the caller to stop.
  validateLinksOptions(links);
  const engine = commander?.engine ?? null;
  const identity = createTraceIdentity({ page });

  // A continuous trace records changes, and a change is only meaningful against
  // something. Taking the base snapshot automatically is the safe default,
  // because a trace that starts mid-air replays as a blank page (issue #93); a
  // checkpoints-only trace is a list of moments the caller named, so nothing is
  // added to it uninvited. Passing a string names the base checkpoint.
  const baseCheckpoint =
    initialCheckpoint ?? recorderMode === TRACE_MODE.CONTINUOUS;

  // The Links Notation export is a second view of the same records, written
  // as they are recorded (issue #94), so a run that is killed leaves a
  // readable export of everything that had happened. The bundle stays
  // authoritative: nothing is written here that is not written there first.
  let linksSink = null;
  const bundle = await openRecorderBundle(options, {
    output,
    limits,
    strict,
    now,
    monotonic,
    onEvent: (event, source) => linksSink?.event(event, source),
  });
  const startedAt = new Date(now()).toISOString();

  try {
    if (links) {
      linksSink = await openTraceLinks({
        output: links.output,
        include: links.include,
        dom: links.dom,
        bundlePath: bundle.root,
        schemaVersion: TRACE_SCHEMA_VERSION,
        mode: recorderMode,
        engine,
        startedAt,
        commanderVersion,
      });
    }
  } catch (error) {
    await bundle.abort();
    throw error;
  }

  let stopped = false;
  const captureState = { index: 0 };
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
    if (commander?.evaluate && typeof page.evaluate !== 'function') {
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

  const checkpoint = createCheckpointRecorder({
    isStopped: () => Boolean(stopped),
    captureState,
    mutations,
    evaluateInPage,
    privacyOptions,
    domOptions,
    links,
    limits,
    captureTimeoutMs,
    bundle,
    screenshot,
    checkpoints,
    record,
  });

  let detachers = [],
    detachNetwork = async () => {},
    video = null;
  try {
    detachers = attachTimelineObservers({
      commander,
      page,
      eventSources,
      record,
      note,
      identity,
      now,
    });
    detachNetwork = attachNetwork({
      page,
      network,
      record,
      note,
      privacy: privacyOptions,
    });
    video = options.video
      ? await startRecording({
          page,
          engine,
          ...(options.video === true ? {} : options.video),
        })
      : null;
    let navigationCapture = Promise.resolve();
    if (options.checkpointOnNavigation) {
      const captureNavigation = () => {
        navigationCapture = navigationCapture
          .then(() =>
            stopped
              ? null
              : checkpoint('navigation', {
                  reason: 'navigation',
                  actor: 'recorder',
                })
          )
          .catch((error) => note(error.message));
      };
      page.on('load', captureNavigation);
      detachers.push(() => page.off('load', captureNavigation));
    }

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
      await checkpoint(
        typeof baseCheckpoint === 'string' ? baseCheckpoint : 'initial',
        {
          actor: 'recorder',
          reason: TRACE_CHECKPOINT_REASON.INITIAL,
        }
      );
    }

    let drainTask;
    if (domOptions.mutations) {
      const timer = setInterval(() => {
        if (!drainTask) {
          drainTask = mutations
            .drain(captureState.index)
            .catch((error) => note(error.message))
            .finally(() => {
              drainTask = null;
            });
        }
      }, 500);
      timer.unref?.();
      detachers.push(async () => {
        clearInterval(timer);
        await drainTask;
      });
    }

    /**
     * Stop recording and write the manifest.
     *
     * @param {Object} [stopOptions] - `{outcome, discard, error}`
     * @returns {Promise<Object>} `{path, manifest, checkpoints}`
     */
    const stop = createTraceStop({
      getStopped: () => stopped,
      setStopped: (value) => {
        stopped = value;
      },
      options,
      detachers,
      navigationCapture: () => navigationCapture,
      video,
      detachNetwork,
      mutations,
      captureState,
      record,
      note,
      bundle,
      recorderMode,
      startedAt,
      now,
      commanderVersion,
      engine,
      domOptions,
      eventSources,
      privacyOptions,
      limits,
      linksSink,
      network,
      checkpoints,
    });

    return {
      path: bundle.root,
      get currentPath() {
        return bundle.currentPath ?? bundle.root;
      },
      get segments() {
        return bundle.segments;
      },
      links: linksSink?.path ?? null,
      mode: recorderMode,
      get bytesWritten() {
        return bundle.bytesWritten;
      },
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
  } catch (error) {
    await abortTraceStart({
      detachers,
      detachNetwork,
      video,
      mutations,
      linksSink,
      bundle,
    });
    throw error;
  }
}

function requireTraceSupport(options) {
  validateNetworkOptions(options.network);
  (options.page ?? options.commander?.page)?.requireFeature?.('tracing');
}

function openRecorderBundle(options, settings) {
  const writer =
    options.openBundle ??
    (options.mode === TRACE_MODE.CONTINUOUS
      ? (config) =>
          openRollingBundle(
            config,
            {
              lazy: true,
              maxBytes: settings.limits.maxBundleBytes ?? 256 * 1024 * 1024,
            },
            options
          )
      : openTraceBundle);
  return writer(settings);
}
