/**
 * The portable browser trace format (issue #87).
 *
 * One engine-neutral, versioned layout is written by JavaScript and read by
 * JavaScript, Python and Rust. Everything about the format that a reader has
 * to agree on lives here, so a change to the layout is a change to one file.
 */

/**
 * Schema version of the bundle.
 *
 * Readers refuse a major version they were not written for rather than
 * guessing at the meaning of unknown records.
 */
export const TRACE_SCHEMA_VERSION = 1;

/** Name every reader looks for inside a bundle. */
export const TRACE_FILES = Object.freeze({
  MANIFEST: 'manifest.json',
  EVENTS: 'events.ndjson',
  CHECKPOINTS_DIR: 'checkpoints',
  MUTATIONS_DIR: 'mutations',
  ARTIFACTS_DIR: 'artifacts',
  VIEWER: 'viewer.html',
});

/** What the recorder captures. */
export const TRACE_MODE = Object.freeze({
  OFF: 'off',
  CHECKPOINTS: 'checkpoints',
  CONTINUOUS: 'continuous',
  RETAIN_ON_FAILURE: 'retain-on-failure',
});

/** Event kinds that share the one ordered timeline. */
export const TRACE_EVENT = Object.freeze({
  TRACE_START: 'trace.start',
  TRACE_STOP: 'trace.stop',
  CHECKPOINT: 'checkpoint',
  MUTATIONS: 'mutations',
  NAVIGATION: 'navigation',
  INTERACTION: 'interaction',
  CONSOLE: 'console',
  PAGE_ERROR: 'pageerror',
  DIALOG: 'dialog',
  REQUEST_FAILED: 'requestfailed',
  DOWNLOAD: 'download',
  /** Something could not be recorded. The run continues; the gap is visible. */
  DROPPED: 'dropped',
});

/** Event families a caller can subscribe the recorder to. */
export const TRACE_EVENT_SOURCES = Object.freeze([
  'navigation',
  'interaction',
  'console',
  'pageerror',
  'dialog',
  'requestfailed',
  'download',
]);

/** Why a record was dropped. */
export const TRACE_DROP_REASON = Object.freeze({
  SIZE_LIMIT: 'size-limit',
  WRITE_FAILED: 'write-failed',
  CAPTURE_FAILED: 'capture-failed',
  PAGE_CLOSED: 'page-closed',
  TIMEOUT: 'timeout',
});

/** How a trace ended, recorded in the manifest. */
export const TRACE_OUTCOME = Object.freeze({
  /** `stop()` was called and every record was written. */
  COMPLETE: 'complete',
  /** The trace is readable but records are missing. */
  PARTIAL: 'partial',
  /** No manifest was ever written; readers repair this on open. */
  TRUNCATED: 'truncated',
});

/** Default ceiling on a bundle, so a runaway page cannot fill a disk. */
export const DEFAULT_MAX_BUNDLE_BYTES = 256 * 1024 * 1024;

/** Default ceiling on any single member of a bundle. */
export const DEFAULT_MAX_RESOURCE_BYTES = 32 * 1024 * 1024;

/** How long a single capture may take before it is dropped. */
export const DEFAULT_CAPTURE_TIMEOUT = 15000;

/**
 * Format a bundle member's sequence number.
 *
 * Zero padding keeps `ls` and any reader that sorts lexically in the same
 * order as the sequence itself.
 *
 * @param {number} index - 1-based sequence number
 * @returns {string} Zero-padded name, such as `0001`
 */
export function sequenceName(index) {
  return String(index).padStart(4, '0');
}

/**
 * Build the manifest of a trace.
 *
 * @param {Object} options - Manifest fields
 * @returns {Object} The manifest as it is written to disk
 */
export function createManifest(options = {}) {
  const {
    mode,
    startedAt,
    stoppedAt = null,
    outcome = TRACE_OUTCOME.COMPLETE,
    commanderVersion = null,
    engine = null,
    browser = null,
    platform = `${process.platform} ${process.arch}`,
    runtime = `node ${process.versions?.node ?? 'unknown'}`,
    counts = {},
    limits = {},
    privacy = {},
    dom = {},
    events = [],
    dropped = 0,
  } = options;

  return {
    schemaVersion: TRACE_SCHEMA_VERSION,
    format: 'browser-commander-trace',
    mode,
    outcome,
    startedAt,
    stoppedAt,
    commanderVersion,
    engine,
    browser,
    platform,
    runtime,
    events: [...events],
    dom: { ...dom },
    privacy: { ...privacy },
    limits: { ...limits },
    counts: { checkpoints: 0, events: 0, mutationBatches: 0, ...counts },
    dropped,
  };
}

/**
 * Check that a manifest can be read by this version of the format.
 *
 * @param {Object} manifest - Parsed manifest
 * @throws {Error} When the bundle is not a readable trace
 */
export function assertReadableManifest(manifest) {
  if (!manifest || manifest.format !== 'browser-commander-trace') {
    throw new Error('not a Browser Commander trace bundle');
  }
  if (manifest.schemaVersion > TRACE_SCHEMA_VERSION) {
    throw new Error(
      `trace schema version ${manifest.schemaVersion} is newer than this reader (${TRACE_SCHEMA_VERSION})`
    );
  }
}
