import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  finishScenarioTrace,
  normalizeTestScreenshots,
  normalizeTestTrace,
  resolveTestDownloads,
  resolveTraceSetting,
  startScenarioTrace,
  TEST_DOWNLOADS_DIRNAME,
  TRACE_BUNDLE_SUFFIX,
  traceOutputPath,
} from '../../../src/tests/tracing.js';
import { readTrace } from '../../../src/traces/reader.js';
import { TRACE_FILES, TRACE_MODE } from '../../../src/traces/schema.js';
import {
  createFakeCommander,
  createFakePage,
  useTempTraceDirectory,
} from '../../helpers/trace-fixtures.js';

describe('test runner tracing (issues #87 and #88)', () => {
  const directory = useTempTraceDirectory();

  describe('normalizing what a scenario asked for', () => {
    it('should treat no trace option as off', () => {
      assert.strictEqual(normalizeTestTrace(undefined), 'off');
      assert.strictEqual(normalizeTestTrace(null), 'off');
      assert.strictEqual(normalizeTestTrace(false), 'off');
    });

    it('should read true as recording the whole run', () => {
      assert.strictEqual(normalizeTestTrace(true), 'on');
    });

    it('should keep the named modes', () => {
      assert.strictEqual(
        normalizeTestTrace('retain-on-failure'),
        'retain-on-failure'
      );
      assert.strictEqual(
        normalizeTestTrace('on-first-retry'),
        'on-first-retry'
      );
    });

    it('should refuse a mode it does not know', () => {
      assert.throws(
        () => normalizeTestTrace('retain-on-tuesday'),
        /trace must be one of off, on, retain-on-failure, on-first-retry/
      );
    });

    it('should default screenshots to only-on-failure', () => {
      assert.strictEqual(
        normalizeTestScreenshots(undefined),
        'only-on-failure'
      );
      assert.strictEqual(normalizeTestScreenshots(true), 'on');
      assert.strictEqual(normalizeTestScreenshots(false), 'off');
      assert.strictEqual(normalizeTestScreenshots('off'), 'off');
    });

    it('should refuse a screenshot mode it does not know', () => {
      assert.throws(
        () => normalizeTestScreenshots('sometimes'),
        /screenshots must be one of/
      );
    });
  });

  describe('deciding whether an attempt records', () => {
    it('should not record when tracing is off', () => {
      assert.strictEqual(resolveTraceSetting('off'), null);
      assert.strictEqual(resolveTraceSetting('off', 3), null);
    });

    it('should keep every bundle when tracing is on', () => {
      assert.deepStrictEqual(resolveTraceSetting('on'), {
        recorderMode: TRACE_MODE.CONTINUOUS,
        retainOnFailure: false,
      });
    });

    it('should record but only keep a failure otherwise', () => {
      assert.deepStrictEqual(resolveTraceSetting('retain-on-failure'), {
        recorderMode: TRACE_MODE.RETAIN_ON_FAILURE,
        retainOnFailure: true,
      });
    });

    it('should wait for the retry when asked to', () => {
      assert.strictEqual(resolveTraceSetting('on-first-retry', 1), null);
      assert.deepStrictEqual(resolveTraceSetting('on-first-retry', 2), {
        recorderMode: TRACE_MODE.RETAIN_ON_FAILURE,
        retainOnFailure: true,
      });
    });
  });

  // The expectations resolve their paths the way the code under test does.
  // A POSIX literal is not a path on Windows: `path.resolve('/a', 'x')` there
  // is `D:\\a\\x`, because a rooted path with no drive means the current one.
  describe('where artifacts go', () => {
    it('should name a bundle after the scenario', () => {
      assert.strictEqual(
        traceOutputPath({ artifactsDir: '/a', safeName: 'checkout' }),
        path.resolve('/a', `checkout${TRACE_BUNDLE_SUFFIX}`)
      );
    });

    it('should keep each retry in its own bundle', () => {
      assert.strictEqual(
        traceOutputPath({
          artifactsDir: '/a',
          safeName: 'checkout',
          attempt: 2,
        }),
        path.resolve('/a', `checkout.attempt-2${TRACE_BUNDLE_SUFFIX}`)
      );
    });

    it('should keep a scenario downloads in its own artifact directory', () => {
      assert.deepStrictEqual(
        resolveTestDownloads(true, {
          artifactsDir: '/a',
          safeName: 'checkout',
        }),
        { directory: path.resolve('/a', 'checkout', TEST_DOWNLOADS_DIRNAME) }
      );
    });

    it('should keep the rest of the download options', () => {
      assert.deepStrictEqual(
        resolveTestDownloads(
          { timeout: 5000, allowOverwrite: true },
          { artifactsDir: '/a', safeName: 'checkout' }
        ),
        {
          timeout: 5000,
          allowOverwrite: true,
          directory: path.resolve('/a', 'checkout', TEST_DOWNLOADS_DIRNAME),
        }
      );
    });

    it('should not move downloads the caller placed itself', () => {
      assert.deepStrictEqual(
        resolveTestDownloads(
          { directory: '/somewhere/else' },
          { artifactsDir: '/a', safeName: 'checkout' }
        ),
        { directory: '/somewhere/else' }
      );
    });

    it('should leave downloads alone when they are not enabled', () => {
      assert.strictEqual(
        resolveTestDownloads(false, { artifactsDir: '/a', safeName: 'x' }),
        false
      );
      assert.strictEqual(
        resolveTestDownloads(undefined, { artifactsDir: '/a', safeName: 'x' }),
        undefined
      );
    });
  });

  describe('recording one scenario', () => {
    /**
     * Start a scenario trace over a fake page.
     *
     * @param {Object} [options] - Overrides for `startScenarioTrace`
     * @returns {Promise<Object>} `{started, page}`
     */
    const start = async (options = {}) => {
      const { page = createFakePage(), ...overrides } = options;
      const started = await startScenarioTrace({
        commander: createFakeCommander(page),
        trace: 'retain-on-failure',
        artifactsDir: directory.path,
        safeName: 'checkout',
        ...overrides,
        page,
      });
      return { started, page };
    };

    it('should not record when the scenario did not ask for a trace', async () => {
      const { started } = await start({ trace: 'off' });

      assert.strictEqual(started, null);
      assert.deepStrictEqual(await fs.readdir(directory.path), []);
    });

    it('should not record when the runner has nowhere to write', async () => {
      const { started } = await start({ trace: 'on', artifactsDir: undefined });

      assert.strictEqual(started, null);
    });

    it('should record DOM mutations whenever it records at all', async () => {
      const { started, page } = await start({ trace: 'retain-on-failure' });

      assert.ok(
        page.state.evaluated.some(
          (call) => call.name === 'installMutationRecorderInPage'
        )
      );
      await started.trace.stop({ discard: true });
    });

    it('should throw away a bundle a passing test left behind', async () => {
      const { started } = await start({ trace: 'retain-on-failure' });

      const stopped = await finishScenarioTrace(started);

      assert.strictEqual(stopped.discarded, true);
      assert.deepStrictEqual(await fs.readdir(directory.path), []);
    });

    it('should keep a failing test bundle, with the error on the timeline', async () => {
      const { started } = await start({ trace: 'retain-on-failure' });

      const stopped = await finishScenarioTrace(started, {
        error: new Error('expected 2 items, found 1'),
      });

      assert.ok(!stopped.discarded);
      const reader = await readTrace(stopped.path);
      const fatal = reader.events.find((event) => event.fatal);
      assert.strictEqual(fatal.message, 'expected 2 items, found 1');
      assert.strictEqual(reader.checkpoints.at(-1).name, 'failure');
      assert.strictEqual(reader.checkpoints.at(-1).actor, 'runner');
    });

    it('should keep a passing test bundle when tracing is simply on', async () => {
      const { started } = await start({ trace: 'on' });

      const stopped = await finishScenarioTrace(started);

      assert.ok(!stopped.discarded);
      assert.strictEqual(
        (await readTrace(stopped.path)).checkpoints.at(-1).name,
        'final'
      );
    });

    it('should leave a viewer beside every bundle it keeps', async () => {
      const { started } = await start({ trace: 'on' });

      const stopped = await finishScenarioTrace(started);

      const viewer = await fs.readFile(
        path.join(stopped.path, TRACE_FILES.VIEWER),
        'utf8'
      );
      assert.match(viewer, /Browser Commander trace/);
    });

    it('should take a failure screenshot even when passing runs take none', async () => {
      const { started, page } = await start({
        trace: 'retain-on-failure',
        screenshots: 'only-on-failure',
      });

      await finishScenarioTrace(started, { error: new Error('nope') });

      assert.strictEqual(page.state.screenshots, 1);
    });

    it('should still stop when the final checkpoint cannot be captured', async () => {
      const page = createFakePage();
      const { started } = await start({ page, trace: 'on' });
      page.failEvaluate(
        'captureSnapshotInPage',
        'Target page, context or browser has been closed'
      );
      const noted = [];

      const stopped = await finishScenarioTrace(started, {
        log: { debug: (message) => noted.push(message) },
      });

      assert.ok(stopped.path);
      assert.ok((await readTrace(stopped.path)).events.length > 0);
      // The page closing is a gap in the trace, not a second failure on top of
      // whatever the test was already reporting.
      assert.ok(noted.every((message) => message.startsWith('[trace]')));
    });

    it('should do nothing when there was no trace to finish', async () => {
      assert.strictEqual(await finishScenarioTrace(null), null);
    });
  });
});
