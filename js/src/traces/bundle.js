/**
 * Writing a trace bundle to disk (issue #87).
 *
 * The bundle is a directory with the documented layout, which `zip -r` turns
 * into the archive form without re-encoding anything, and which `ls` and
 * `cat` can already read.
 *
 * Every write here is best-effort by default: a trace exists to explain a run,
 * so failing to record something must leave a visible gap rather than break
 * the automation that was being recorded.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_MAX_BUNDLE_BYTES,
  DEFAULT_MAX_RESOURCE_BYTES,
  TRACE_DROP_REASON,
  TRACE_EVENT,
  TRACE_FILES,
  TRACE_OUTCOME,
  sequenceName,
} from './schema.js';

/** Owner-only file mode: a trace may hold form values and page content. */
export const TRACE_FILE_MODE = 0o600;

/** Owner-only directory mode for the bundle root. */
export const TRACE_DIRECTORY_MODE = 0o700;

/**
 * Open a bundle for writing.
 *
 * @param {Object} options - `{output, limits, strict, now, onEvent}`
 * @returns {Promise<Object>} The bundle writer
 */
export async function openTraceBundle(options = {}) {
  const {
    output,
    strict = false,
    limits = {},
    now = () => Date.now(),
    onEvent = null,
  } = options;

  if (typeof output !== 'string' || output === '') {
    throw new Error('trace output must be a path');
  }

  const root = path.resolve(output);
  const maxBundleBytes = limits.maxBundleBytes ?? DEFAULT_MAX_BUNDLE_BYTES;
  const maxResourceBytes =
    limits.maxResourceBytes ?? DEFAULT_MAX_RESOURCE_BYTES;
  const maxEventBytes = limits.maxEventBytes ?? maxResourceBytes;

  await fs.mkdir(root, { recursive: true, mode: TRACE_DIRECTORY_MODE });

  const eventsPath = path.join(root, TRACE_FILES.EVENTS);
  const eventsHandle = await fs.open(eventsPath, 'a', TRACE_FILE_MODE);

  let written = 0;
  let sequence = 0;
  // Appends are serialized. Listeners report what happened without waiting
  // for the previous record to reach the disk, and a timeline whose lines
  // arrive in a different order than the events did is not a timeline.
  let appendQueue = Promise.resolve();
  let dropped = 0;
  const counts = { checkpoints: 0, events: 0, mutationBatches: 0 };
  const problems = [];

  const fits = (bytes) =>
    bytes <= maxResourceBytes && written + bytes <= maxBundleBytes;

  // A record of something that was dropped is the one write that must not be
  // dropped in turn, so it answers to the bundle budget alone.
  const fitsEvent = (bytes, retry) =>
    written + bytes <= maxBundleBytes && (!retry || bytes <= maxEventBytes);

  /**
   * Record that something could not be written.
   *
   * @param {Object} record - `{reason, detail, member}`
   * @returns {Promise<void>}
   */
  async function drop(record) {
    dropped += 1;
    problems.push(record);
    if (strict) {
      throw new Error(
        `trace ${record.member ?? 'record'} dropped: ${record.reason}${
          record.detail ? ` (${record.detail})` : ''
        }`
      );
    }
    // The drop is itself an event, so a reader sees the gap in the timeline
    // instead of silently reading a shorter story than the one that happened.
    await appendEvent(
      { kind: TRACE_EVENT.DROPPED, ...record },
      { retry: false }
    );
  }

  /**
   * Append one event to the timeline.
   *
   * @param {Object} event - Event fields; `sequence` and `at` are added
   * @param {Object} [options] - `{retry}`
   * @returns {Promise<Object|null>} The event as written
   */
  async function appendEvent(event, { retry = true } = {}) {
    const record = {
      sequence: ++sequence,
      at: new Date(now()).toISOString(),
      monotonicMs: Math.round(performance.now()),
      ...event,
    };
    const line = `${JSON.stringify(record)}\n`;
    const bytes = Buffer.byteLength(line);

    if (!fitsEvent(bytes, retry)) {
      if (retry) {
        await drop({
          reason: TRACE_DROP_REASON.SIZE_LIMIT,
          member: TRACE_FILES.EVENTS,
          detail: `${bytes} bytes`,
        });
      }
      return null;
    }

    const pending = appendQueue.then(() => eventsHandle.write(line));
    appendQueue = pending.then(
      () => {},
      () => {}
    );

    try {
      await pending;
      written += bytes;
      counts.events += 1;
      if (onEvent) {
        try {
          await onEvent(record);
        } catch (error) {
          // A side export that fails is a gap in that export, not in the
          // bundle. Reporting it through `drop` would write an event and call
          // this hook again, so it is noted where a caller can still see it.
          problems.push({
            reason: TRACE_DROP_REASON.WRITE_FAILED,
            member: 'links',
            detail: error.message,
          });
        }
      }
      return record;
    } catch (error) {
      if (retry) {
        await drop({
          reason: TRACE_DROP_REASON.WRITE_FAILED,
          member: TRACE_FILES.EVENTS,
          detail: error.message,
        });
      }
      return null;
    }
  }

  /**
   * Write one member of the bundle.
   *
   * @param {string} member - Path relative to the bundle root
   * @param {string|Buffer} contents - What to write
   * @returns {Promise<Object|null>} `{member, bytes}` or null when dropped
   */
  async function writeMember(member, contents) {
    const data = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);

    if (!fits(data.length)) {
      await drop({
        reason: TRACE_DROP_REASON.SIZE_LIMIT,
        member,
        detail: `${data.length} bytes`,
      });
      return null;
    }

    const target = path.join(root, member);
    try {
      await fs.mkdir(path.dirname(target), {
        recursive: true,
        mode: TRACE_DIRECTORY_MODE,
      });
      await fs.writeFile(target, data, { mode: TRACE_FILE_MODE });
      written += data.length;
      return { member, bytes: data.length };
    } catch (error) {
      await drop({
        reason: TRACE_DROP_REASON.WRITE_FAILED,
        member,
        detail: error.message,
      });
      return null;
    }
  }

  /**
   * Write a checkpoint's HTML, state and screenshot.
   *
   * @param {Object} checkpoint - `{index, html, state, screenshot}`
   * @returns {Promise<Object>} What was written, by member name
   */
  async function writeCheckpoint({ index, html, state, screenshot }) {
    const name = sequenceName(index);
    const members = {};

    if (typeof html === 'string') {
      const result = await writeMember(
        `${TRACE_FILES.CHECKPOINTS_DIR}/${name}.html`,
        html
      );
      if (result) {
        members.html = result.member;
      }
    }
    if (state) {
      const result = await writeMember(
        `${TRACE_FILES.CHECKPOINTS_DIR}/${name}.state.json`,
        `${JSON.stringify(state, null, 2)}\n`
      );
      if (result) {
        members.state = result.member;
      }
    }
    if (screenshot) {
      const result = await writeMember(
        `${TRACE_FILES.CHECKPOINTS_DIR}/${name}.png`,
        screenshot
      );
      if (result) {
        members.screenshot = result.member;
      }
    }

    counts.checkpoints += 1;
    return members;
  }

  /**
   * Write one checkpoint's mutation batches.
   *
   * @param {number} index - Checkpoint the batches follow
   * @param {Object[]} batches - Ordered mutation batches
   * @returns {Promise<string|null>} Member name, or null when nothing was written
   */
  async function writeMutations(index, batches) {
    if (!batches || batches.length === 0) {
      return null;
    }
    const member = `${TRACE_FILES.MUTATIONS_DIR}/${sequenceName(index)}.ndjson`;
    const body = `${batches.map((batch) => JSON.stringify(batch)).join('\n')}\n`;
    const result = await writeMember(member, body);
    if (result) {
      counts.mutationBatches += batches.length;
    }
    return result ? result.member : null;
  }

  /**
   * Store a resource by the hash of its contents.
   *
   * Content addressing is what keeps one screenshot taken twice, or a file
   * downloaded in three scenarios, from being stored three times.
   *
   * @param {Buffer|string} contents - Resource bytes
   * @param {string} [extension] - Extension to keep, such as `.png`
   * @returns {Promise<Object|null>} `{member, sha256, bytes}`
   */
  async function writeArtifact(contents, extension = '') {
    const data = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
    const sha256 = createHash('sha256').update(data).digest('hex');
    const member = `${TRACE_FILES.ARTIFACTS_DIR}/${sha256}${extension}`;

    try {
      await fs.access(path.join(root, member));
      return { member, sha256, bytes: data.length, deduplicated: true };
    } catch {
      // Not stored yet.
    }

    const result = await writeMember(member, data);
    return result ? { ...result, sha256, deduplicated: false } : null;
  }

  return {
    root,
    counts,
    problems,
    get dropped() {
      return dropped;
    },
    get bytesWritten() {
      return written;
    },
    appendEvent,
    writeMember,
    writeCheckpoint,
    writeMutations,
    writeArtifact,
    drop,
    /**
     * Write the manifest and close the timeline.
     *
     * @param {Object} manifest - Manifest built by `createManifest`
     * @returns {Promise<Object>} The manifest as written
     */
    close: async (manifest) => {
      const finished = {
        ...manifest,
        counts: { ...counts },
        dropped,
        outcome:
          dropped > 0 && manifest.outcome === TRACE_OUTCOME.COMPLETE
            ? TRACE_OUTCOME.PARTIAL
            : manifest.outcome,
      };
      // Anything a listener reported on its way out is still queued.
      await appendQueue;
      await eventsHandle.close();
      await fs.writeFile(
        path.join(root, TRACE_FILES.MANIFEST),
        `${JSON.stringify(finished, null, 2)}\n`,
        { mode: TRACE_FILE_MODE }
      );
      return finished;
    },
  };
}
