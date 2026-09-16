import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';

import { startTrace } from '../../../src/traces/recorder.js';
import { readTrace } from '../../../src/traces/reader.js';
import { REDACTED } from '../../../src/traces/redaction.js';
import {
  TRACE_DROP_REASON,
  TRACE_EVENT,
  TRACE_MODE,
  TRACE_OUTCOME,
} from '../../../src/traces/schema.js';
import {
  createFakeCommander,
  createFakeDownloads,
  createFakePage,
  makeSnapshot,
  useTempTraceDirectory,
} from '../../helpers/trace-fixtures.js';

describe('trace recorder (issue #87)', () => {
  const directory = useTempTraceDirectory();

  /**
   * Start a trace over a fake page and commander.
   *
   * @param {Object} [options] - `{page, commander, ...startTrace options}`
   * @returns {Promise<Object>} `{trace, page, commander}`
   */
  const start = async (options = {}) => {
    const {
      page = createFakePage(),
      commander = createFakeCommander(page, options.commanderExtras ?? {}),
      commanderExtras: _extras,
      ...traceOptions
    } = options;

    const trace = await startTrace({
      commander,
      page,
      output: path.join(directory.path, 'run'),
      ...traceOptions,
    });

    return { trace, page, commander };
  };

  /**
   * Read the whole bundle a stopped trace left behind.
   *
   * @param {Object} stopped - What `stop()` returned
   * @returns {Promise<Object>} The reader
   */
  const read = (stopped) => readTrace(stopped.path);

  /**
   * The first event of one kind a stopped trace holds.
   *
   * @param {Object} stopped - What `stop()` returned
   * @param {string} kind - One of TRACE_EVENT
   * @returns {Promise<Object|undefined>} The event
   */
  const eventOfKind = async (stopped, kind) =>
    (await read(stopped)).events.find((event) => event.kind === kind);

  /**
   * The first gap a stopped trace recorded.
   *
   * @param {Object} stopped - What `stop()` returned
   * @returns {Promise<Object|undefined>} The dropped event
   */
  const firstDrop = (stopped) => eventOfKind(stopped, TRACE_EVENT.DROPPED);

  describe('starting', () => {
    it('should refuse to record without a page', async () => {
      await assert.rejects(
        startTrace({ output: path.join(directory.path, 'run') }),
        /requires a page or a commander/
      );
    });

    it('should refuse a mode it does not know', async () => {
      await assert.rejects(
        start({ mode: 'sometimes' }),
        /trace mode must be one of/
      );
    });

    it('should refuse an event source it does not know', async () => {
      await assert.rejects(
        start({ events: ['telepathy'] }),
        /unknown trace event source/
      );
    });

    it('should open the timeline with what it is about to record', async () => {
      const { trace } = await start({ mode: TRACE_MODE.CHECKPOINTS });
      const stopped = await trace.stop();

      const started = (await read(stopped)).events[0];
      assert.strictEqual(started.kind, TRACE_EVENT.TRACE_START);
      assert.strictEqual(started.mode, TRACE_MODE.CHECKPOINTS);
      assert.strictEqual(started.engine, 'playwright');
      assert.ok(started.events.includes('console'));
    });

    it('should record mutations without being asked in continuous mode', async () => {
      const { trace, page } = await start({ mode: TRACE_MODE.CONTINUOUS });
      await trace.stop();

      assert.ok(
        page.state.evaluated.some(
          (call) => call.name === 'installMutationRecorderInPage'
        )
      );
    });

    it('should leave the page alone when mutations are not recorded', async () => {
      const { trace, page } = await start({ mode: TRACE_MODE.CHECKPOINTS });
      await trace.stop();

      assert.ok(
        !page.state.evaluated.some(
          (call) => call.name === 'installMutationRecorderInPage'
        )
      );
    });
  });

  describe('checkpoints', () => {
    it('should capture HTML, live state and a screenshot together', async () => {
      const { trace } = await start({ screenshots: true });

      const entry = await trace.checkpoint('after login', { actor: 'user' });
      const stopped = await trace.stop();

      assert.strictEqual(entry.index, 1);
      assert.deepStrictEqual(entry.members, {
        html: 'checkpoints/0001.html',
        state: 'checkpoints/0001.state.json',
        screenshot: 'checkpoints/0001.png',
      });

      const reader = await read(stopped);
      assert.match(await reader.html(1), /captured/);
      const state = await reader.state(1);
      assert.strictEqual(state.name, 'after login');
      assert.strictEqual(state.actor, 'user');
      assert.strictEqual(state.controls[0].value, 'alice');
    });

    it('should not take a screenshot the caller did not ask for', async () => {
      const { trace, page } = await start({ screenshots: false });

      await trace.checkpoint('start');

      assert.strictEqual(page.state.screenshots, 0);
    });

    it('should take a screenshot only on failure when asked', async () => {
      const { trace, page } = await start({ screenshots: 'only-on-failure' });

      await trace.checkpoint('start');
      assert.strictEqual(page.state.screenshots, 0);

      await trace.checkpoint('the end', { reason: 'failure' });
      assert.strictEqual(page.state.screenshots, 1);
    });

    it('should keep a gap rather than fail when the page has closed', async () => {
      const { trace, page } = await start({ screenshots: false });
      page.failEvaluate(
        'captureSnapshotInPage',
        'Target page, context or browser has been closed'
      );

      const entry = await trace.checkpoint('after the crash');
      const stopped = await trace.stop();

      assert.deepStrictEqual(entry.members, {});
      const dropped = await firstDrop(stopped);
      assert.strictEqual(dropped.reason, TRACE_DROP_REASON.PAGE_CLOSED);
      assert.strictEqual(stopped.manifest.outcome, TRACE_OUTCOME.PARTIAL);
    });

    it('should give a capture its own deadline', async () => {
      const page = createFakePage();
      page.evaluate = () => new Promise(() => {});
      const { trace } = await start({
        page,
        commander: null,
        captureTimeoutMs: 20,
      });

      await trace.checkpoint('hangs');
      const stopped = await trace.stop();

      const dropped = await firstDrop(stopped);
      assert.match(dropped.detail, /timed out after 20ms/);
    });

    it('should refuse a checkpoint after the trace has stopped', async () => {
      const { trace } = await start();
      await trace.stop();

      await assert.rejects(
        trace.checkpoint('too late'),
        /already been stopped/
      );
    });

    it('should reinstall the mutation recorder a navigation threw away', async () => {
      const { trace, page } = await start({ mode: TRACE_MODE.CONTINUOUS });

      await trace.checkpoint('after navigation');

      const installs = page.state.evaluated.filter(
        (call) => call.name === 'installMutationRecorderInPage'
      );
      assert.strictEqual(installs.length, 2);
    });
  });

  describe('mutations', () => {
    it('should keep ordered batches between checkpoints', async () => {
      const page = createFakePage({
        mutations: [
          { sequence: 1, records: [{ type: 'childList' }] },
          { sequence: 2, records: [{ type: 'attributes' }] },
        ],
      });
      const { trace } = await start({ page, mode: TRACE_MODE.CONTINUOUS });

      await trace.checkpoint('after the update');
      const stopped = await trace.stop();

      const batches = await (await read(stopped)).mutations(0);
      assert.deepStrictEqual(
        batches.map((batch) => batch.sequence),
        [1, 2]
      );
    });

    it('should record that the page dropped mutations of its own', async () => {
      const page = createFakePage({
        mutations: [{ sequence: 1, records: [] }],
        droppedMutations: 12,
      });
      const { trace } = await start({ page, mode: TRACE_MODE.CONTINUOUS });

      await trace.checkpoint('after the storm');
      const stopped = await trace.stop();

      const dropped = await firstDrop(stopped);
      assert.strictEqual(dropped.reason, TRACE_DROP_REASON.SIZE_LIMIT);
      assert.match(dropped.detail, /12 records/);
    });
  });

  describe('the shared timeline', () => {
    /** A completed download, as the manager reports one. */
    const COMPLETED_DOWNLOAD = Object.freeze({
      id: 'download-1',
      suggestedFilename: 'report.pdf',
      path: '/tmp/downloads/report.pdf',
      checksum: 'abc123',
      bytes: 2048,
    });

    it('should order navigation, interactions and page events as they happened', async () => {
      const downloads = createFakeDownloads();
      const { trace, page, commander } = await start({
        commanderExtras: { downloads },
      });

      await commander.goto('https://example.com/login');
      page.emit('console', { type: () => 'warning', text: () => 'slow' });
      page.emit('pageerror', new Error('boom'));
      page.emit('requestfailed', {
        url: () => 'https://example.com/missing',
        method: () => 'GET',
        failure: () => ({ errorText: 'net::ERR_FAILED' }),
      });
      page.emit('framenavigated', { url: () => 'https://example.com/home' });
      downloads.emit('completed', COMPLETED_DOWNLOAD);
      const stopped = await trace.stop();

      const kinds = (await read(stopped)).events.map((event) => event.kind);
      assert.deepStrictEqual(kinds, [
        TRACE_EVENT.TRACE_START,
        TRACE_EVENT.INTERACTION,
        TRACE_EVENT.CONSOLE,
        TRACE_EVENT.PAGE_ERROR,
        TRACE_EVENT.REQUEST_FAILED,
        TRACE_EVENT.NAVIGATION,
        TRACE_EVENT.DOWNLOAD,
        TRACE_EVENT.TRACE_STOP,
      ]);
      const sequences = (await read(stopped)).events.map(
        (event) => event.sequence
      );
      assert.deepStrictEqual(sequences, [1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it('should reference a download by path and checksum, not by its bytes', async () => {
      const downloads = createFakeDownloads();
      const { trace } = await start({ commanderExtras: { downloads } });

      downloads.emit('completed', {
        ...COMPLETED_DOWNLOAD,
        url: 'https://example.com/report.pdf?token=secret',
      });
      const stopped = await trace.stop();

      const event = await eventOfKind(stopped, TRACE_EVENT.DOWNLOAD);
      assert.strictEqual(event.path, '/tmp/downloads/report.pdf');
      assert.strictEqual(event.checksum, 'abc123');
      assert.strictEqual(event.bytes, 2048);
      assert.strictEqual(
        event.url,
        `https://example.com/report.pdf?token=${REDACTED}`
      );
      assert.ok(!Object.hasOwn(event, 'contents'));
    });

    it('should record what an interaction did without recording what was typed', async () => {
      const { trace, commander } = await start();

      await commander.typeText('#password', 'hunter2');
      const stopped = await trace.stop();

      const body = await fs.readFile(
        path.join(stopped.path, 'events.ndjson'),
        'utf8'
      );
      const event = await eventOfKind(stopped, TRACE_EVENT.INTERACTION);
      assert.strictEqual(event.action, 'typeText');
      assert.strictEqual(event.target, '#password');
      assert.strictEqual(event.ok, true);
      assert.ok(!body.includes('hunter2'));
    });

    it('should record an interaction that failed and rethrow it', async () => {
      const page = createFakePage();
      const commander = createFakeCommander(page, {
        click: async () => {
          throw new Error('element is covered');
        },
      });
      const { trace } = await start({ page, commander });

      await assert.rejects(commander.click('#buy'), /element is covered/);
      const stopped = await trace.stop();

      const event = await eventOfKind(stopped, TRACE_EVENT.INTERACTION);
      assert.strictEqual(event.ok, false);
      assert.strictEqual(event.error, 'element is covered');
    });

    it('should let a caller put its own step on the same timeline', async () => {
      const { trace } = await start();

      await trace.event('paid the invoice', { invoice: 'INV-42' });
      const stopped = await trace.stop();

      const event = (await read(stopped)).events.find(
        (record) => record.actor === 'caller'
      );
      assert.strictEqual(event.action, 'paid the invoice');
      assert.strictEqual(event.invoice, 'INV-42');
    });

    it('should only observe the sources the caller asked for', async () => {
      const { trace, page, commander } = await start({ events: ['console'] });

      page.emit('console', { type: () => 'log', text: () => 'hello' });
      await commander.goto('https://example.com');
      const stopped = await trace.stop();

      const kinds = (await read(stopped)).events.map((event) => event.kind);
      assert.ok(kinds.includes(TRACE_EVENT.CONSOLE));
      assert.ok(!kinds.includes(TRACE_EVENT.INTERACTION));
    });

    it('should stop observing once the trace is stopped', async () => {
      const { trace, page, commander } = await start();
      const wrapped = commander.goto;

      const stopped = await trace.stop();
      page.emit('console', { type: () => 'log', text: () => 'after' });

      assert.strictEqual(page.listenerCount('console'), 0);
      assert.notStrictEqual(commander.goto, wrapped);
      const body = await fs.readFile(
        path.join(stopped.path, 'events.ndjson'),
        'utf8'
      );
      assert.ok(!body.includes('after'));
    });
  });

  describe('privacy', () => {
    it('should keep a secret out of every member of the bundle', async () => {
      const page = createFakePage({
        snapshot: makeSnapshot({
          state: {
            url: 'https://example.com/report?access_token=super-secret',
            controls: [
              { path: 'input#token', tag: 'input', value: 'super-secret' },
            ],
          },
        }),
      });
      const { trace } = await start({
        page,
        screenshots: false,
        privacy: { redactPatterns: ['super-secret'] },
      });

      await trace.checkpoint('after login');
      await trace.event('used the token', { token: 'super-secret' });
      const stopped = await trace.stop();

      for (const member of await fs.readdir(stopped.path, {
        recursive: true,
        withFileTypes: true,
      })) {
        if (!member.isFile()) {
          continue;
        }
        const body = await fs.readFile(
          path.join(member.parentPath ?? member.path, member.name),
          'utf8'
        );
        assert.ok(
          !body.includes('super-secret'),
          `${member.name} still holds the secret`
        );
      }
    });

    it('should record the privacy settings it applied', async () => {
      const { trace } = await start({
        privacy: { redactSelectors: ['.card-number'], redact: () => 'x' },
      });

      const stopped = await trace.stop();

      assert.ok(
        stopped.manifest.privacy.redactSelectors.includes('.card-number')
      );
      assert.strictEqual(stopped.manifest.privacy.hasCallback, true);
    });
  });

  describe('stopping', () => {
    it('should write a readable manifest and report the checkpoints', async () => {
      const { trace } = await start();

      await trace.checkpoint('one');
      await trace.checkpoint('two');
      const stopped = await trace.stop();

      assert.strictEqual(stopped.manifest.counts.checkpoints, 2);
      assert.strictEqual(stopped.manifest.outcome, TRACE_OUTCOME.COMPLETE);
      assert.ok(stopped.manifest.stoppedAt);
      assert.deepStrictEqual(
        stopped.checkpoints.map((entry) => entry.name),
        ['one', 'two']
      );
      assert.strictEqual(trace.stopped, true);
    });

    it('should record the error a run ended with', async () => {
      const { trace } = await start();

      const stopped = await trace.stop({
        error: new Error('assertion failed'),
      });

      const fatal = (await read(stopped)).events.find(
        (event) => event.kind === TRACE_EVENT.PAGE_ERROR && event.fatal
      );
      assert.strictEqual(fatal.message, 'assertion failed');
    });

    it('should remove a bundle it was told to discard', async () => {
      const { trace } = await start();

      const stopped = await trace.stop({ discard: true });

      assert.strictEqual(stopped.discarded, true);
      await assert.rejects(fs.stat(stopped.path), { code: 'ENOENT' });
    });

    it('should answer the same way when stopped twice', async () => {
      const { trace } = await start();

      const first = await trace.stop();
      const second = await trace.stop();

      assert.strictEqual(first, second);
    });
  });
});
