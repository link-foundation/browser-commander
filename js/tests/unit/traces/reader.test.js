import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';

import { openTraceBundle } from '../../../src/traces/bundle.js';
import {
  diffControlState,
  parseNdjson,
  readTrace,
} from '../../../src/traces/reader.js';
import {
  createManifest,
  TRACE_EVENT,
  TRACE_FILES,
  TRACE_MODE,
  TRACE_OUTCOME,
} from '../../../src/traces/schema.js';
import { useTempTraceDirectory } from '../../helpers/trace-fixtures.js';

describe('trace reader (issue #87)', () => {
  const directory = useTempTraceDirectory();

  /**
   * Write a small bundle the tests can read back.
   *
   * @param {Object} [options] - `{close}`; a bundle that is not closed has no
   *   manifest, exactly like a run that was killed
   * @returns {Promise<Object>} The bundle writer
   */
  const writeBundle = async ({ close = true } = {}) => {
    const bundle = await openTraceBundle({
      output: path.join(directory.path, 'run'),
    });
    await bundle.appendEvent({
      kind: TRACE_EVENT.TRACE_START,
      mode: TRACE_MODE.CHECKPOINTS,
      engine: 'playwright',
      events: ['console'],
    });
    const members = await bundle.writeCheckpoint({
      index: 1,
      html: '<html><body>one</body></html>',
      state: {
        url: 'https://example.com/one',
        controls: [{ path: 'input', value: 'before' }],
      },
    });
    await bundle.appendEvent({
      kind: TRACE_EVENT.CHECKPOINT,
      index: 1,
      name: 'start',
      actor: 'automation',
      reason: 'checkpoint',
      url: 'https://example.com/one',
      members,
    });
    await bundle.writeMutations(1, [{ records: [{ type: 'childList' }] }]);
    if (close) {
      await bundle.close(createManifest({ mode: TRACE_MODE.CHECKPOINTS }));
    }
    return bundle;
  };

  describe('parseNdjson', () => {
    it('should keep everything before a half-written line', () => {
      const parsed = parseNdjson('{"a":1}\n{"b":2}\n{"c":');

      assert.deepStrictEqual(parsed.records, [{ a: 1 }, { b: 2 }]);
      assert.strictEqual(parsed.truncated, true);
    });

    it('should read an empty body as an empty timeline', () => {
      assert.deepStrictEqual(parseNdjson(null), {
        records: [],
        truncated: false,
      });
    });
  });

  describe('readTrace', () => {
    it('should read the manifest, timeline and checkpoint members', async () => {
      const bundle = await writeBundle();

      const trace = await readTrace(bundle.root);

      assert.strictEqual(trace.manifest.outcome, TRACE_OUTCOME.COMPLETE);
      assert.strictEqual(trace.checkpoints.length, 1);
      assert.strictEqual(trace.checkpoints[0].name, 'start');
      assert.match(await trace.html(1), /one/);
      assert.strictEqual((await trace.state(1)).url, 'https://example.com/one');
      assert.strictEqual((await trace.mutations(1)).length, 1);
      assert.strictEqual(trace.truncated, false);
    });

    it('should return nothing for a checkpoint member that was dropped', async () => {
      const bundle = await writeBundle();

      const trace = await readTrace(bundle.root);

      assert.strictEqual(await trace.html(2), null);
      assert.strictEqual(await trace.state(2), null);
      assert.deepStrictEqual(await trace.mutations(2), []);
    });

    it('should rebuild a manifest for a run that never stopped', async () => {
      const bundle = await writeBundle({ close: false });

      const trace = await readTrace(bundle.root);

      assert.strictEqual(trace.manifest.outcome, TRACE_OUTCOME.TRUNCATED);
      assert.strictEqual(trace.manifest.engine, 'playwright');
      assert.strictEqual(trace.manifest.counts.checkpoints, 1);
      assert.strictEqual(trace.truncated, true);
      assert.match(await trace.html(1), /one/);
    });

    it('should read a timeline whose last line was cut off', async () => {
      const bundle = await writeBundle({ close: false });
      await fs.appendFile(
        path.join(bundle.root, TRACE_FILES.EVENTS),
        '{"kind":"console","text":"half'
      );

      const trace = await readTrace(bundle.root);

      assert.strictEqual(trace.truncated, true);
      assert.strictEqual(trace.events.length, 2);
    });

    it('should refuse a directory that holds no trace', async () => {
      await assert.rejects(
        readTrace(path.join(directory.path, 'nothing-here')),
        /no trace bundle at/
      );
    });

    it('should refuse a manifest that is not readable JSON', async () => {
      const bundle = await writeBundle();
      await fs.writeFile(
        path.join(bundle.root, TRACE_FILES.MANIFEST),
        'not json'
      );

      await assert.rejects(readTrace(bundle.root), /is not readable JSON/);
    });

    it('should refuse a bundle written by a newer format', async () => {
      const bundle = await writeBundle();
      await fs.writeFile(
        path.join(bundle.root, TRACE_FILES.MANIFEST),
        JSON.stringify({
          format: 'browser-commander-trace',
          schemaVersion: 99,
        })
      );

      await assert.rejects(readTrace(bundle.root), /newer than this reader/);
    });
  });

  describe('diffControlState', () => {
    it('should report what a step changed, added and removed', () => {
      const changes = diffControlState(
        {
          controls: [
            { path: 'input#name', value: 'before' },
            { path: 'input#gone', value: 'x' },
            { path: 'input#same', value: 'stable' },
          ],
        },
        {
          controls: [
            { path: 'input#name', value: 'after' },
            { path: 'input#same', value: 'stable' },
            { path: 'input#new', value: 'fresh' },
          ],
        }
      );

      assert.deepStrictEqual(changes, [
        {
          path: 'input#name',
          change: 'changed',
          before: 'before',
          after: 'after',
        },
        { path: 'input#new', change: 'added', after: 'fresh' },
        { path: 'input#gone', change: 'removed', before: 'x' },
      ]);
    });

    it('should report a checkbox by what it is checked to', () => {
      const changes = diffControlState(
        { controls: [{ path: 'input', checked: false, value: 'on' }] },
        { controls: [{ path: 'input', checked: true, value: 'on' }] }
      );

      assert.deepStrictEqual(changes, [
        { path: 'input', change: 'changed', before: false, after: true },
      ]);
    });

    it('should read a missing state as no controls at all', () => {
      assert.deepStrictEqual(diffControlState(null, null), []);
    });
  });
});
