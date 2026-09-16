import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  assertReadableManifest,
  createManifest,
  sequenceName,
  TRACE_EVENT,
  TRACE_MODE,
  TRACE_OUTCOME,
  TRACE_SCHEMA_VERSION,
} from '../../../src/traces/schema.js';

describe('trace schema (issue #87)', () => {
  describe('sequenceName', () => {
    it('should sort lexically in the same order as the sequence', () => {
      const names = [10, 2, 1].map(sequenceName).sort();

      assert.deepStrictEqual(names, ['0001', '0002', '0010']);
    });
  });

  describe('createManifest', () => {
    it('should record the version, engine and environment of the run', () => {
      const manifest = createManifest({
        mode: TRACE_MODE.CHECKPOINTS,
        startedAt: '2026-01-01T00:00:00.000Z',
        engine: 'playwright',
        commanderVersion: '0.17.2',
      });

      assert.strictEqual(manifest.schemaVersion, TRACE_SCHEMA_VERSION);
      assert.strictEqual(manifest.format, 'browser-commander-trace');
      assert.strictEqual(manifest.engine, 'playwright');
      assert.strictEqual(manifest.commanderVersion, '0.17.2');
      assert.ok(manifest.platform.includes(process.platform));
      assert.ok(manifest.runtime.startsWith('node '));
    });

    it('should start every counter at zero', () => {
      const manifest = createManifest({ mode: TRACE_MODE.CONTINUOUS });

      assert.deepStrictEqual(manifest.counts, {
        checkpoints: 0,
        events: 0,
        mutationBatches: 0,
      });
      assert.strictEqual(manifest.outcome, TRACE_OUTCOME.COMPLETE);
    });

    it('should copy collections so a caller cannot mutate the manifest', () => {
      const events = ['console'];
      const manifest = createManifest({ mode: TRACE_MODE.OFF, events });

      events.push('download');

      assert.deepStrictEqual(manifest.events, ['console']);
    });
  });

  describe('assertReadableManifest', () => {
    it('should accept a manifest of this version', () => {
      assert.doesNotThrow(() =>
        assertReadableManifest(createManifest({ mode: TRACE_MODE.CHECKPOINTS }))
      );
    });

    it('should refuse a directory that is not a trace bundle', () => {
      assert.throws(
        () => assertReadableManifest({ format: 'something-else' }),
        /not a Browser Commander trace bundle/
      );
    });

    it('should refuse a schema it was not written for', () => {
      assert.throws(
        () =>
          assertReadableManifest({
            format: 'browser-commander-trace',
            schemaVersion: TRACE_SCHEMA_VERSION + 1,
          }),
        /newer than this reader/
      );
    });
  });

  describe('event kinds', () => {
    it('should name a dropped record so gaps stay visible', () => {
      assert.strictEqual(TRACE_EVENT.DROPPED, 'dropped');
    });
  });
});
