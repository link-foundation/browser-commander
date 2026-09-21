import { describe, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  openTraceBundle,
  TRACE_FILE_MODE,
} from '../../../src/traces/bundle.js';
import {
  createManifest,
  TRACE_DROP_REASON,
  TRACE_EVENT,
  TRACE_FILES,
  TRACE_MODE,
  TRACE_OUTCOME,
} from '../../../src/traces/schema.js';
import {
  useTempTraceDirectory,
  useTraceBundleCleanup,
} from '../../helpers/trace-fixtures.js';

describe('trace bundle writer (issue #87)', () => {
  const directory = useTempTraceDirectory();
  const cleanup = useTraceBundleCleanup();

  /**
   * Open a bundle inside the suite's temporary directory.
   *
   * @param {Object} [options] - Options for `openTraceBundle`
   * @returns {Promise<Object>} The bundle writer
   */
  const open = async (options = {}) =>
    cleanup(
      await openTraceBundle({
        output: path.join(directory.path, 'run'),
        ...options,
      })
    );

  /**
   * List a bundle's members, relative to its root.
   *
   * @param {string} root - Bundle directory
   * @returns {Promise<string[]>} Sorted member names
   */
  const members = async (root) =>
    (await fs.readdir(root, { recursive: true }))
      .map((entry) => entry.split(path.sep).join('/'))
      .sort();

  /**
   * Read the timeline back.
   *
   * @param {string} root - Bundle directory
   * @returns {Promise<Object[]>} Parsed events
   */
  const timeline = async (root) =>
    (await fs.readFile(path.join(root, TRACE_FILES.EVENTS), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

  /**
   * The first gap the bundle recorded.
   *
   * @param {string} root - Bundle directory
   * @returns {Promise<Object|undefined>} The dropped event
   */
  const firstDrop = async (root) =>
    (await timeline(root)).find((event) => event.kind === TRACE_EVENT.DROPPED);

  it('should refuse to open without an output path', async () => {
    await assert.rejects(openTraceBundle({}), /trace output must be a path/);
  });

  it('should abort an unfinished bundle without writing a manifest', async () => {
    const bundle = await open();
    await bundle.appendEvent({ kind: TRACE_EVENT.CHECKPOINT });

    await bundle.abort();
    await bundle.abort();

    await assert.rejects(
      fs.access(path.join(bundle.root, TRACE_FILES.MANIFEST))
    );
  });

  it('should write the layout the format documents', async () => {
    const bundle = await open();

    await bundle.writeCheckpoint({
      index: 1,
      html: '<html></html>',
      state: { url: 'https://example.com' },
      screenshot: Buffer.from('png'),
    });
    await bundle.writeMutations(1, [{ records: [] }]);
    await bundle.writeArtifact('report body', '.txt');
    await bundle.close(createManifest({ mode: TRACE_MODE.CHECKPOINTS }));

    assert.deepStrictEqual(await members(bundle.root), [
      'artifacts',
      `artifacts/${crypto.createHash('sha256').update('report body').digest('hex')}.txt`,
      'checkpoints',
      'checkpoints/0001.html',
      'checkpoints/0001.png',
      'checkpoints/0001.state.json',
      'events.ndjson',
      'manifest.json',
      'mutations',
      'mutations/0001.ndjson',
    ]);
  });

  it('should number events and stamp them with both clocks', async () => {
    const bundle = await open();

    const first = await bundle.appendEvent({ kind: TRACE_EVENT.CHECKPOINT });
    const second = await bundle.appendEvent({ kind: TRACE_EVENT.CONSOLE });

    assert.strictEqual(first.sequence, 1);
    assert.strictEqual(second.sequence, 2);
    assert.ok(Date.parse(first.at) > 0);
    assert.ok(second.monotonicMs >= first.monotonicMs);
  });

  it('should keep a trace readable for its owner only', async () => {
    if (process.platform === 'win32') {
      return;
    }
    const bundle = await open();

    await bundle.appendEvent({ kind: TRACE_EVENT.CHECKPOINT });
    await bundle.close(createManifest({ mode: TRACE_MODE.CHECKPOINTS }));

    const mode = (await fs.stat(path.join(bundle.root, TRACE_FILES.MANIFEST)))
      .mode;
    assert.strictEqual(mode & 0o777, TRACE_FILE_MODE);
  });

  it('should store one resource once, however often it is written', async () => {
    const bundle = await open();

    const first = await bundle.writeArtifact('same bytes', '.txt');
    const second = await bundle.writeArtifact('same bytes', '.txt');

    assert.strictEqual(first.member, second.member);
    assert.strictEqual(first.deduplicated, false);
    assert.strictEqual(second.deduplicated, true);
    assert.deepStrictEqual(
      (await fs.readdir(path.join(bundle.root, TRACE_FILES.ARTIFACTS_DIR)))
        .length,
      1
    );
  });

  it('should drop a member over the per-resource limit and say so', async () => {
    const bundle = await open({ limits: { maxResourceBytes: 16 } });

    const result = await bundle.writeMember(
      'checkpoints/0001.html',
      'x'.repeat(64)
    );
    await bundle.close(createManifest({ mode: TRACE_MODE.CHECKPOINTS }));

    assert.strictEqual(result, null);
    assert.strictEqual(bundle.dropped, 1);
    const dropped = await firstDrop(bundle.root);
    assert.strictEqual(dropped.reason, TRACE_DROP_REASON.SIZE_LIMIT);
    assert.strictEqual(dropped.member, 'checkpoints/0001.html');
  });

  it('should report a partial trace once anything was dropped', async () => {
    const bundle = await open({ limits: { maxResourceBytes: 4 } });

    await bundle.writeMember('checkpoints/0001.html', 'over the limit');
    const manifest = await bundle.close(
      createManifest({ mode: TRACE_MODE.CHECKPOINTS })
    );

    assert.strictEqual(manifest.outcome, TRACE_OUTCOME.PARTIAL);
    assert.strictEqual(manifest.dropped, 1);
  });

  it('should raise the first problem in strict mode instead of recording it', async () => {
    const bundle = await open({
      strict: true,
      limits: { maxResourceBytes: 4 },
    });

    await assert.rejects(
      bundle.writeMember('checkpoints/0001.html', 'over the limit'),
      /dropped: size-limit/
    );
  });

  it('should record a write it could not perform', async () => {
    const bundle = await open();
    // A member whose parent is a file, not a directory, cannot be written.
    await bundle.writeMember('blocked', 'i am a file');

    const result = await bundle.writeMember('blocked/0001.html', 'content');

    assert.strictEqual(result, null);
    assert.strictEqual(
      bundle.problems[0].reason,
      TRACE_DROP_REASON.WRITE_FAILED
    );
  });

  it('should write nothing for an empty batch of mutations', async () => {
    const bundle = await open();

    assert.strictEqual(await bundle.writeMutations(1, []), null);
    assert.strictEqual(await bundle.writeMutations(1, null), null);
    assert.strictEqual(bundle.counts.mutationBatches, 0);
  });

  it('should count what it wrote in the manifest', async () => {
    const bundle = await open();

    await bundle.writeCheckpoint({ index: 1, html: '<html></html>' });
    await bundle.writeMutations(1, [{ records: [1] }, { records: [2] }]);
    const manifest = await bundle.close(
      createManifest({ mode: TRACE_MODE.CONTINUOUS })
    );

    assert.strictEqual(manifest.counts.checkpoints, 1);
    assert.strictEqual(manifest.counts.mutationBatches, 2);
    assert.strictEqual(manifest.outcome, TRACE_OUTCOME.COMPLETE);
  });

  it('should record a dropped member even under a tiny resource limit', async () => {
    // The record of a gap must not be the next thing that falls through it.
    const bundle = await open({ limits: { maxResourceBytes: 16 } });

    await bundle.writeMember('checkpoints/0001.html', 'x'.repeat(64));

    const dropped = await firstDrop(bundle.root);
    assert.strictEqual(dropped.reason, TRACE_DROP_REASON.SIZE_LIMIT);
  });

  it('should write the timeline in the order the events happened', async () => {
    const bundle = await open();

    // Observers report what happened without awaiting the record, so the
    // writes overlap; the file must still read as the story in order.
    await Promise.all(
      Array.from({ length: 50 }, (_unused, index) =>
        bundle.appendEvent({ kind: TRACE_EVENT.CONSOLE, index })
      )
    );

    const written = await timeline(bundle.root);
    assert.deepStrictEqual(
      written.map((event) => event.index),
      Array.from({ length: 50 }, (_unused, index) => index)
    );
    assert.deepStrictEqual(
      written.map((event) => event.sequence),
      Array.from({ length: 50 }, (_unused, index) => index + 1)
    );
  });

  it('should stop appending once the bundle limit is reached', async () => {
    const bundle = await open({ limits: { maxBundleBytes: 220 } });

    let accepted = 0;
    for (let index = 0; index < 20; index++) {
      if (await bundle.appendEvent({ kind: TRACE_EVENT.CONSOLE, index })) {
        accepted += 1;
      }
    }

    assert.ok(accepted > 0, 'the first events still fit');
    assert.ok(accepted < 20, 'the limit stopped the rest');
    assert.ok(bundle.bytesWritten <= 220);
  });
});
