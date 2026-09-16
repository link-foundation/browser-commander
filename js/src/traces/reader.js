/**
 * Reading a trace bundle (issue #87).
 *
 * The reader assumes nothing finished cleanly. A run that was killed leaves a
 * bundle with no manifest and a half-written last line; that bundle still
 * holds the evidence someone is looking for, so it is repaired on open rather
 * than rejected.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  assertReadableManifest,
  createManifest,
  sequenceName,
  TRACE_FILES,
  TRACE_MODE,
  TRACE_OUTCOME,
} from './schema.js';

async function readIfPresent(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Parse an NDJSON body, keeping everything before the first unreadable line.
 *
 * @param {string|null} body - File contents
 * @returns {Object} `{records, truncated}`
 */
export function parseNdjson(body) {
  const records = [];
  let truncated = false;

  for (const line of (body ?? '').split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    try {
      records.push(JSON.parse(line));
    } catch {
      // A process killed mid-write leaves one partial line. Everything before
      // it is still true, so the trace is readable up to that point.
      truncated = true;
      break;
    }
  }

  return { records, truncated };
}

/**
 * Open a trace bundle.
 *
 * @param {string} bundlePath - Path to the bundle directory
 * @returns {Promise<Object>} `{path, manifest, events, checkpoints, truncated}`
 */
export async function readTrace(bundlePath) {
  const root = path.resolve(bundlePath);
  const manifestBody = await readIfPresent(
    path.join(root, TRACE_FILES.MANIFEST)
  );
  const eventsBody = await readIfPresent(path.join(root, TRACE_FILES.EVENTS));

  if (manifestBody === null && eventsBody === null) {
    throw new Error(`no trace bundle at ${root}`);
  }

  const { records: events, truncated } = parseNdjson(eventsBody);

  let manifest;
  if (manifestBody === null) {
    // No manifest means the run never reached `stop()`. The timeline is the
    // record of what happened; the manifest is rebuilt around it.
    const started = events.find((event) => event.kind === 'trace.start');
    manifest = createManifest({
      mode: started?.mode ?? TRACE_MODE.CHECKPOINTS,
      startedAt: started?.at ?? null,
      stoppedAt: events.at(-1)?.at ?? null,
      outcome: TRACE_OUTCOME.TRUNCATED,
      engine: started?.engine ?? null,
      events: started?.events ?? [],
      dom: started?.dom ?? {},
      counts: {
        events: events.length,
        checkpoints: events.filter((event) => event.kind === 'checkpoint')
          .length,
      },
    });
  } else {
    try {
      manifest = JSON.parse(manifestBody);
    } catch {
      throw new Error(
        `${TRACE_FILES.MANIFEST} in ${root} is not readable JSON`
      );
    }
    assertReadableManifest(manifest);
  }

  const checkpoints = events
    .filter((event) => event.kind === 'checkpoint')
    .map((event) => ({
      index: event.index,
      name: event.name,
      actor: event.actor,
      reason: event.reason,
      url: event.url,
      at: event.at,
      sequence: event.sequence,
      members: event.members ?? {},
    }));

  return {
    path: root,
    manifest,
    events,
    checkpoints,
    truncated: truncated || manifest.outcome !== TRACE_OUTCOME.COMPLETE,
    /**
     * Read one checkpoint's HTML.
     *
     * @param {number} index - Checkpoint number
     * @returns {Promise<string|null>} The captured markup
     */
    html: (index) =>
      readIfPresent(
        path.join(
          root,
          TRACE_FILES.CHECKPOINTS_DIR,
          `${sequenceName(index)}.html`
        )
      ),
    /**
     * Read one checkpoint's live control state.
     *
     * @param {number} index - Checkpoint number
     * @returns {Promise<Object|null>} The captured state
     */
    state: async (index) => {
      const body = await readIfPresent(
        path.join(
          root,
          TRACE_FILES.CHECKPOINTS_DIR,
          `${sequenceName(index)}.state.json`
        )
      );
      return body === null ? null : JSON.parse(body);
    },
    /**
     * Read the mutation batches recorded after one checkpoint.
     *
     * @param {number} index - Checkpoint number
     * @returns {Promise<Object[]>} Ordered batches
     */
    mutations: async (index) => {
      const body = await readIfPresent(
        path.join(
          root,
          TRACE_FILES.MUTATIONS_DIR,
          `${sequenceName(index)}.ndjson`
        )
      );
      return parseNdjson(body).records;
    },
  };
}

/**
 * Diff two checkpoints' control state.
 *
 * `{before, after, actor}` per control is the shape a reviewer needs to answer
 * "what did this step change?" without reading two HTML files side by side.
 *
 * @param {Object} before - State of the earlier checkpoint
 * @param {Object} after - State of the later checkpoint
 * @returns {Object[]} One record per changed control
 */
export function diffControlState(before, after) {
  const index = new Map(
    (before?.controls ?? []).map((control) => [control.path, control])
  );
  const changes = [];

  for (const control of after?.controls ?? []) {
    const previous = index.get(control.path);
    index.delete(control.path);
    if (!previous) {
      changes.push({
        path: control.path,
        change: 'added',
        after: control.value,
      });
      continue;
    }
    if (
      previous.value !== control.value ||
      previous.checked !== control.checked
    ) {
      changes.push({
        path: control.path,
        change: 'changed',
        before:
          previous.checked === undefined ? previous.value : previous.checked,
        after: control.checked === undefined ? control.value : control.checked,
      });
    }
  }

  for (const control of index.values()) {
    changes.push({
      path: control.path,
      change: 'removed',
      before: control.value,
    });
  }

  return changes;
}
