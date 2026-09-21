import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';

import { readTrace } from '../../../src/traces/reader.js';
import { startTrace } from '../../../src/traces/recorder.js';
import { TRACE_FILES, TRACE_MODE } from '../../../src/traces/schema.js';
import {
  DEFAULT_MAX_INLINE_BYTES,
  renderTraceViewer,
  writeTraceViewer,
} from '../../../src/traces/viewer.js';
import {
  createFakeCommander,
  createFakePage,
  makeSnapshot,
  useTempTraceDirectory,
} from '../../helpers/trace-fixtures.js';
import { assertMode } from '../../helpers/file-modes.js';

describe('offline trace viewer (issue #87)', () => {
  const directory = useTempTraceDirectory();

  /**
   * Start a recorder over a fake page.
   *
   * @param {string} name - Directory the bundle is written to
   * @param {Object} [options] - `{pageOptions, page, ...startTrace options}`
   * @returns {Promise<Object>} `{trace, page}`
   */
  const beginTrace = async (name, options = {}) => {
    const {
      pageOptions = {},
      page = createFakePage(pageOptions),
      ...rest
    } = options;
    const trace = await startTrace({
      commander: createFakeCommander(page),
      page,
      output: path.join(directory.path, name),
      mode: TRACE_MODE.CONTINUOUS,
      screenshots: false,
      // These are tests about what the viewer does with the checkpoints it is
      // given, so the checkpoints are exactly the ones each test names. The
      // base snapshot a continuous trace takes on its own is covered by the
      // recorder's suite (issue #93).
      initialCheckpoint: false,
      ...rest,
    });
    return { trace, page };
  };

  /**
   * Record a small trace and return the path to its bundle.
   *
   * @param {Object} [options] - `{pageOptions, checkpoints, ...startTrace options}`
   * @returns {Promise<string>} Bundle path
   */
  const recordBundle = async (options = {}) => {
    const { checkpoints = ['first'], ...rest } = options;
    const { trace } = await beginTrace(
      `run-${Math.random().toString(36).slice(2)}`,
      rest
    );
    for (const name of checkpoints) {
      await trace.checkpoint(name);
    }
    return (await trace.stop()).path;
  };

  /**
   * The JSON the viewer carries inline.
   *
   * @param {string} viewer - The rendered viewer document
   * @returns {Object} The embedded trace data
   */
  const embedded = (viewer) =>
    JSON.parse(
      viewer.match(
        /<script id="trace-data" type="application\/json">([\s\S]*?)<\/script>/
      )[1]
    );

  /**
   * Render the viewer for a bundle recorded from one snapshot.
   *
   * @param {Object} [snapshot] - A snapshot from `makeSnapshot()`
   * @returns {Promise<string>} The viewer document
   */
  const renderFor = async (snapshot) =>
    renderTraceViewer(
      await readTrace(
        await recordBundle(snapshot ? { pageOptions: { snapshot } } : {})
      )
    );

  /**
   * Stop a trace and read back what its viewer would carry.
   *
   * @param {Object} trace - A running trace
   * @returns {Promise<Object>} The embedded trace data
   */
  const dataAfterStopping = async (trace) => {
    const stopped = await trace.stop();
    return embedded(await renderTraceViewer(await readTrace(stopped.path)));
  };

  describe('inertness', () => {
    it('should forbid everything the captured page might reach for', async () => {
      const viewer = await renderFor();

      const policy = viewer.match(
        /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/
      )[1];
      assert.match(policy, /default-src 'none'/);
      // No `connect-src`, no `http:` and no `https:` anywhere in the policy:
      // opening a colleague's trace must not call anyone's server.
      assert.ok(!/https?:/.test(policy));
      assert.ok(!policy.includes('connect-src'));
    });

    it('should render the captured page in a frame with no privileges', async () => {
      const viewer = await renderFor();

      const frame = viewer.match(/<iframe [^>]*>/)[0];
      // A bare `sandbox` is the empty allow-list: no scripts, no forms, no
      // top-level navigation, and an opaque origin.
      assert.match(frame, /\ssandbox(\s|>)/);
      assert.ok(!frame.includes('allow-scripts'));
      assert.ok(!frame.includes('allow-forms'));
      assert.ok(!frame.includes('allow-same-origin'));
      assert.match(frame, /referrerpolicy="no-referrer"/);
    });

    it('should never let captured markup become part of the viewer document', async () => {
      const page = createFakePage({
        snapshot: makeSnapshot({
          html: '<html><body></script><script>fetch("https://attacker.example")</script><img src=x onerror=alert(1)></body></html>',
        }),
      });
      const viewer = await renderFor(page.state.snapshot);

      // Exactly the viewer's own two scripts: the embedded data and the UI.
      assert.strictEqual(viewer.match(/<script/g).length, 2);
      // Every angle bracket the page produced is escaped, so none of its
      // markup can become an element of the viewer's own document.
      assert.ok(!viewer.includes('<img'));
      assert.ok(!viewer.includes('</script><script>'));
      // The markup is still there, escaped, so a reviewer can read it.
      assert.ok(viewer.includes('\\u003cimg src=x onerror=alert(1)\\u003e'));
    });

    it('should escape the line separators a JavaScript parser treats as newlines', async () => {
      const page = createFakePage({
        snapshot: makeSnapshot({ html: '<p>one two three</p>' }),
      });
      const viewer = await renderFor(page.state.snapshot);

      assert.ok(!viewer.includes(' '));
      assert.ok(!viewer.includes(' '));
      assert.ok(viewer.includes('\\u2028'));
    });
  });

  describe('what it embeds', () => {
    it('should carry the trace inline so it opens from a file:// URL', async () => {
      const bundle = await recordBundle({ checkpoints: ['first', 'second'] });

      const viewer = await renderTraceViewer(await readTrace(bundle));

      const data = embedded(viewer);
      assert.strictEqual(data.checkpoints.length, 2);
      assert.match(data.html[1], /captured/);
      assert.ok(data.state[1].controls.length > 0);
      assert.ok(data.events.length > 0);
      // Member names are metadata on the timeline; nothing is loaded from
      // them, because a viewer that fetched would not open from a file:// URL.
      assert.ok(!/(?:src|href)="[^"]*checkpoints\//.test(viewer));
      assert.ok(!viewer.includes('fetch('));
    });

    it('should carry ordered mutation batches for replay', async () => {
      const { trace, page } = await beginTrace('replayed');
      await trace.checkpoint('first');
      // The batches the page produced *after* the first checkpoint belong to
      // that checkpoint's interval, which is what replay animates.
      page.queueMutations([
        { sequence: 1, records: [{ kind: 'attributes' }] },
        { sequence: 2, records: [{ kind: 'childList' }] },
      ]);
      await trace.checkpoint('second');

      const data = await dataAfterStopping(trace);

      assert.deepStrictEqual(
        data.mutations[1].map((batch) => batch.sequence),
        [1, 2]
      );
    });

    it('should diff each checkpoint against the one before it', async () => {
      const { trace, page } = await beginTrace('diffed');
      await trace.checkpoint('before');
      page.setSnapshot(
        makeSnapshot({
          state: {
            controls: [{ path: 'form > input', tag: 'input', value: 'bob' }],
          },
        })
      );
      await trace.checkpoint('after');

      const data = await dataAfterStopping(trace);

      assert.deepStrictEqual(data.diffs[1], []);
      assert.deepStrictEqual(data.diffs[2], [
        {
          path: 'form > input',
          change: 'changed',
          before: 'alice',
          after: 'bob',
        },
      ]);
    });

    it('should leave out a checkpoint too large to embed and say which', async () => {
      const bundle = await recordBundle();

      const viewer = await renderTraceViewer(await readTrace(bundle), {
        maxInlineBytes: 8,
      });

      const data = embedded(viewer);
      assert.deepStrictEqual(data.elided, [1]);
      assert.strictEqual(data.html[1], null);
      // The checkpoint itself is still on the timeline; only its markup is gone.
      assert.strictEqual(data.checkpoints.length, 1);
      assert.ok(data.state[1]);
    });

    it('should embed everything short of the default ceiling', async () => {
      assert.strictEqual(DEFAULT_MAX_INLINE_BYTES, 8 * 1024 * 1024);

      const viewer = await renderFor();

      const data = embedded(viewer);
      assert.deepStrictEqual(data.elided, []);
    });

    it('should show what the run was and how it ended', async () => {
      const viewer = await renderFor();

      assert.match(viewer, /mode continuous/);
      assert.match(viewer, /outcome complete/);
      assert.match(viewer, /engine playwright/);
    });
  });

  describe('writing it into a bundle', () => {
    it('should put the viewer next to the trace it explains', async () => {
      const bundle = await recordBundle();

      const target = await writeTraceViewer(bundle);

      assert.strictEqual(target, path.join(bundle, TRACE_FILES.VIEWER));
      const body = await fs.readFile(target, 'utf8');
      assert.match(body, /^<!DOCTYPE html>/);
      await assertMode(target, 0o600);
    });

    it('should still explain a run that never stopped', async () => {
      const { trace } = await beginTrace('killed');
      await trace.checkpoint('the last thing it did');
      // No `stop()`: the process was killed, so there is no manifest.
      await fs.rm(path.join(trace.path, TRACE_FILES.MANIFEST), { force: true });

      const body = await fs.readFile(
        await writeTraceViewer(trace.path),
        'utf8'
      );

      assert.match(body, /outcome truncated/);
      assert.match(body, /the last thing it did|1 checkpoints/);

      // The assertions model an interrupted process; this test process keeps
      // running, so explicitly release the descriptor afterwards.
      await trace.stop();
    });

    it('should refuse a directory that is not a bundle', async () => {
      const empty = path.join(directory.path, 'not-a-bundle');
      await fs.mkdir(empty, { recursive: true });

      await assert.rejects(writeTraceViewer(empty), /no trace bundle at/);
    });
  });
});
