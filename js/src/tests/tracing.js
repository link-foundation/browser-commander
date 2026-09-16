/**
 * Trace and download artifacts for the Browser Commander test runner
 * (issues #87 and #88).
 *
 * A failing browser test is only useful if it can be read afterwards. The
 * runner therefore records the same portable trace bundle every other
 * consumer gets, instead of inventing a second artifact format, and points
 * managed downloads at the same artifact directory so a trace can reference
 * files that are still on disk.
 */

import path from 'node:path';
import { startTrace } from '../traces/recorder.js';
import { writeTraceViewer } from '../traces/viewer.js';
import { TRACE_MODE } from '../traces/schema.js';

/** Trace settings a scenario may ask for, in Playwright's vocabulary. */
export const TEST_TRACE_MODES = Object.freeze([
  'off',
  'on',
  'retain-on-failure',
  'on-first-retry',
]);

/** Screenshot settings a scenario may ask for. */
export const TEST_SCREENSHOT_MODES = Object.freeze([
  'off',
  'on',
  'only-on-failure',
]);

/** Suffix that marks a trace bundle directory. */
export const TRACE_BUNDLE_SUFFIX = '.bc-trace';

/** Directory managed downloads use inside a test's artifact directory. */
export const TEST_DOWNLOADS_DIRNAME = 'downloads';

/**
 * Read a scenario's `trace` option.
 *
 * @param {boolean|string} [trace] - `true`, `false` or one of TEST_TRACE_MODES
 * @returns {string} One of TEST_TRACE_MODES
 */
export function normalizeTestTrace(trace) {
  if (trace === undefined || trace === null || trace === false) {
    return 'off';
  }
  if (trace === true) {
    return 'on';
  }
  if (!TEST_TRACE_MODES.includes(trace)) {
    throw new Error(`trace must be one of ${TEST_TRACE_MODES.join(', ')}`);
  }
  return trace;
}

/**
 * Read a scenario's `screenshots` option.
 *
 * @param {boolean|string} [screenshots] - `true`, `false` or one of
 *   TEST_SCREENSHOT_MODES
 * @returns {string} One of TEST_SCREENSHOT_MODES
 */
export function normalizeTestScreenshots(screenshots) {
  if (screenshots === undefined || screenshots === null) {
    return 'only-on-failure';
  }
  if (screenshots === true) {
    return 'on';
  }
  if (screenshots === false) {
    return 'off';
  }
  if (!TEST_SCREENSHOT_MODES.includes(screenshots)) {
    throw new Error(
      `screenshots must be one of ${TEST_SCREENSHOT_MODES.join(', ')}`
    );
  }
  return screenshots;
}

/**
 * Decide whether this attempt records, and in which recorder mode.
 *
 * @param {string} trace - A value from `normalizeTestTrace()`
 * @param {number} attempt - 1 for the first run, 2 for the first retry
 * @returns {{recorderMode: string, retainOnFailure: boolean}|null} The
 *   recorder settings, or null when this attempt does not record
 */
export function resolveTraceSetting(trace, attempt = 1) {
  if (trace === 'off') {
    return null;
  }
  if (trace === 'on-first-retry' && attempt < 2) {
    return null;
  }
  return {
    recorderMode:
      trace === 'on' ? TRACE_MODE.CONTINUOUS : TRACE_MODE.RETAIN_ON_FAILURE,
    retainOnFailure: trace !== 'on',
  };
}

function screenshotSettingForRecorder(screenshots) {
  if (screenshots === 'on') {
    return true;
  }
  if (screenshots === 'off') {
    return false;
  }
  return 'only-on-failure';
}

/**
 * Where one attempt's trace bundle lives.
 *
 * @param {Object} options - `{artifactsDir, safeName, attempt}`
 * @returns {string} The bundle directory
 */
export function traceOutputPath(options = {}) {
  const { artifactsDir, safeName, attempt = 1 } = options;
  const suffix = attempt > 1 ? `.attempt-${attempt}` : '';
  return path.resolve(
    artifactsDir,
    `${safeName}${suffix}${TRACE_BUNDLE_SUFFIX}`
  );
}

/**
 * Point a scenario's managed downloads at its own artifact directory, so a
 * completed download is still there when the trace that references it is read
 * (issue #88).
 *
 * @param {boolean|Object} downloads - The scenario's `downloads` option
 * @param {Object} options - `{artifactsDir, safeName}`
 * @returns {boolean|Object|undefined} The download options to launch with
 */
export function resolveTestDownloads(downloads, options = {}) {
  const { artifactsDir, safeName } = options;
  if (!downloads || !artifactsDir) {
    return downloads;
  }
  const settings = downloads === true ? {} : downloads;
  if (settings.directory) {
    return settings;
  }
  return {
    ...settings,
    directory: path.resolve(artifactsDir, safeName, TEST_DOWNLOADS_DIRNAME),
  };
}

/**
 * Start a trace for one scenario attempt.
 *
 * @param {Object} options - `{commander, page, trace, screenshots,
 *   artifactsDir, safeName, attempt, traceOptions}`
 * @returns {Promise<Object|null>} `{trace, path, retainOnFailure}`, or null
 *   when this attempt does not record
 */
export async function startScenarioTrace(options = {}) {
  const {
    commander,
    page,
    trace,
    screenshots,
    artifactsDir,
    safeName,
    attempt = 1,
    traceOptions = {},
  } = options;

  const setting = resolveTraceSetting(normalizeTestTrace(trace), attempt);
  if (!setting || !artifactsDir) {
    return null;
  }

  const running = await startTrace({
    commander,
    page,
    output: traceOutputPath({ artifactsDir, safeName, attempt }),
    mode: setting.recorderMode,
    screenshots: screenshotSettingForRecorder(
      normalizeTestScreenshots(screenshots)
    ),
    // A test that fails halfway is exactly where ordered DOM mutations pay
    // for themselves, so they are on whenever the runner records.
    dom: { mutations: true },
    ...traceOptions,
  });

  return {
    trace: running,
    path: running.path,
    retainOnFailure: setting.retainOnFailure,
  };
}

/**
 * Stop a scenario's trace, keeping it only when it is worth keeping.
 *
 * @param {Object|null} started - What `startScenarioTrace()` returned
 * @param {Object} [options] - `{error, log}`
 * @returns {Promise<Object|null>} The stopped trace, or null
 */
export async function finishScenarioTrace(started, options = {}) {
  if (!started) {
    return null;
  }

  const { error = null, log } = options;
  const { trace, retainOnFailure } = started;
  const note = (message) => log?.debug?.(`[trace] ${message}`);

  try {
    await trace.checkpoint(error ? 'failure' : 'final', {
      actor: 'runner',
      reason: error ? 'failure' : 'final',
    });
  } catch (checkpointError) {
    note(`could not capture the final checkpoint: ${checkpointError.message}`);
  }

  const discard = Boolean(retainOnFailure) && !error;
  const stopped = await trace.stop({ error, discard });

  if (!discard) {
    try {
      await writeTraceViewer(stopped.path);
    } catch (viewerError) {
      note(`could not write the viewer: ${viewerError.message}`);
    }
  }

  return stopped;
}
