/**
 * Real-browser tests for issue #87.
 *
 * A trace claims to hold the state a run was actually in: the value a user
 * typed rather than the one the server sent, the DOM changes an app made
 * between two moments, and every navigation, interaction, console message,
 * error, failed request, dialog and download in one order. None of that can
 * be proven against a fake page, so these drive both engines and finish by
 * opening the offline viewer in the same browser.
 *
 * Run with: npm run test:e2e:traces
 */

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { makeBrowserCommander } from '../../src/factory.js';
import { readTrace } from '../../src/traces/reader.js';
import { startTrace } from '../../src/traces/recorder.js';
import {
  TRACE_DROP_REASON,
  TRACE_EVENT,
  TRACE_FILES,
  TRACE_MODE,
  TRACE_OUTCOME,
} from '../../src/traces/schema.js';
import { writeTraceViewer } from '../../src/traces/viewer.js';
import { launchE2EBrowser } from '../helpers/e2e-browser.js';
import {
  startTraceServer,
  TRACE_DOWNLOAD_BODY,
  TRACE_SECRET,
} from '../helpers/trace-server.js';

const ENGINES = ['playwright', 'puppeteer'];

/**
 * Run the trace expectations against one engine.
 *
 * @param {string} engine - 'playwright' or 'puppeteer'
 * @returns {void}
 */
function describeTraces(engine) {
  describe(`E2E - portable traces with ${engine} (issue #87)`, () => {
    let server;
    let browser;
    let page;
    let downloads;
    let commander;
    let artifacts;
    let downloadDirectory;
    let cleanup;
    let runs = 0;

    before(async () => {
      server = await startTraceServer();
      artifacts = await fs.mkdtemp(path.join(os.tmpdir(), 'bc-e2e-traces-'));
      downloadDirectory = await fs.mkdtemp(
        path.join(os.tmpdir(), 'bc-e2e-files-')
      );
      ({ browser, page, downloads, cleanup } = await launchE2EBrowser({
        engine,
        downloadDirectory,
      }));
      commander = makeBrowserCommander({ page, downloads });
    });

    beforeEach(async () => {
      await page.goto(`${server.baseUrl}/`);
    });

    after(async () => {
      await commander?.destroy();
      await cleanup?.();
      await server?.close();
      for (const directory of [artifacts, downloadDirectory]) {
        await fs.rm(directory, { recursive: true, force: true });
      }
    });

    /**
     * Start a trace into this run's own bundle directory.
     *
     * @param {Object} [options] - Options for `commander.startTrace()`
     * @returns {Promise<Object>} The running trace
     */
    const record = (options = {}) =>
      commander.startTrace({
        output: path.join(artifacts, `run-${++runs}`),
        screenshots: false,
        ...options,
      });

    /**
     * Wait until the page is somewhere.
     *
     * @param {RegExp} pattern - What the URL must match
     * @returns {Promise<void>} Resolves once it does
     */
    const waitForUrl = async (pattern) => {
      const deadline = Date.now() + 20000;
      while (!pattern.test(page.url())) {
        if (Date.now() > deadline) {
          throw new Error(`still at ${page.url()}, expected ${pattern}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    };

    /**
     * Drive the fixture through one app update, between two checkpoints.
     *
     * Two items are added and an attribute changes, so the batches recorded
     * between the checkpoints hold both kinds of DOM change the format
     * promises to preserve.
     *
     * @param {Object} trace - A running trace in continuous mode
     * @returns {Promise<void>} Resolves once the second checkpoint is written
     */
    const recordAnAppUpdate = async (trace) => {
      await trace.checkpoint('loaded');
      await page.click('#add');
      await page.click('#add');
      await page.click('#touch');
      await trace.checkpoint('the app updated itself');
    };

    /**
     * Wait until the timeline holds every kind of event named.
     *
     * The observers write as things happen, so asking right after a click is
     * asking too early; this waits for the record rather than for a guess.
     *
     * @param {Object} trace - A running trace
     * @param {string[]} kinds - Event kinds that must be present
     * @returns {Promise<Object[]>} The timeline
     */
    const waitForEvents = async (trace, kinds) => {
      const deadline = Date.now() + 20000;
      let seen = new Set();
      for (;;) {
        const { events } = await readTrace(trace.path);
        seen = new Set(events.map((event) => event.kind));
        if (kinds.every((kind) => seen.has(kind))) {
          return events;
        }
        if (Date.now() > deadline) {
          throw new Error(
            `timed out waiting for ${kinds.join(', ')}; saw ${[...seen].join(', ')}`
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };

    /**
     * Choose an option, the same way in either engine.
     *
     * @param {string} selector - The select element
     * @param {string} value - Option value to choose
     * @returns {Promise<void>} Resolves once chosen
     */
    const choose = (selector, value) =>
      commander.evaluate(
        (options) => {
          const element = document.querySelector(options.selector);
          element.value = options.value;
          element.dispatchEvent(new Event('change', { bubbles: true }));
        },
        { selector, value }
      );

    /**
     * The control state one checkpoint captured, by CSS path.
     *
     * @param {Object} state - A checkpoint's state
     * @returns {Map<string, Object>} Controls, keyed by path
     */
    const controlsOf = (state) =>
      new Map(state.controls.map((control) => [control.path, control]));

    /**
     * Every record in a checkpoint's mutation batches.
     *
     * @param {Object[]} batches - Batches from `reader.mutations()`
     * @returns {Object[]} The records, in order
     */
    const changesIn = (batches) => batches.flatMap((batch) => batch.records);

    it('should capture the state a user made, not the state the server sent', async () => {
      const trace = await record({ screenshots: 'checkpoints' });

      await page.type('#name', 'ada');
      await page.click('#terms');
      await choose('#plan', 'pro');
      await trace.checkpoint('the form is filled in');
      const stopped = await trace.stop();

      const reader = await readTrace(stopped.path);
      const controls = controlsOf(await reader.state(1));
      assert.strictEqual(controls.get('#name').value, 'ada');
      assert.strictEqual(controls.get('#terms').checked, true);
      assert.deepStrictEqual(controls.get('#plan').selected, ['pro']);
      const state = await reader.state(1);
      assert.strictEqual(state.title, 'Traced app');
      assert.strictEqual(state.url, `${server.baseUrl}/`);
      // The frame is part of the moment too, and so is a picture of it.
      assert.deepStrictEqual(
        state.frames.map((frame) => frame.name),
        ['inner']
      );
      // The serialized markup carries the typed value, which `outerHTML`
      // alone would not: a replay of this checkpoint shows a filled-in form.
      assert.match(await reader.html(1), /id="name"[^>]*value="ada"/);
      const shot = await fs.readFile(
        path.join(stopped.path, TRACE_FILES.CHECKPOINTS_DIR, '0001.png')
      );
      assert.strictEqual(shot.subarray(1, 4).toString(), 'PNG');
    });

    it('should keep ordered mutations across an app update and a navigation', async () => {
      const trace = await record({ mode: TRACE_MODE.CONTINUOUS });

      await recordAnAppUpdate(trace);
      await page.click('#next');
      await waitForUrl(/\/next$/);
      await trace.checkpoint('the next document');
      await page.click('#grow');
      const stopped = await trace.stop();

      const reader = await readTrace(stopped.path);
      const batches = await reader.mutations(1);
      const added = changesIn(batches)
        .flatMap((change) => change.added ?? [])
        .filter((node) => node?.id);
      assert.deepStrictEqual(
        added.map((node) => node.id),
        ['item-1', 'item-2']
      );
      const attribute = changesIn(batches).find(
        (change) => change.kind === 'attributes'
      );
      assert.strictEqual(attribute.attribute, 'data-state');
      assert.strictEqual(attribute.before, 'idle');
      assert.strictEqual(attribute.after, 'touched');
      assert.deepStrictEqual(
        batches.map((batch) => batch.sequence),
        batches.map((_batch, index) => index + 1)
      );

      // The navigation threw the in-page recorder away with the document it
      // lived in; a batch after it proves a new one took its place.
      const afterNavigating = await reader.mutations(3);
      assert.ok(
        changesIn(afterNavigating)
          .flatMap((change) => change.added ?? [])
          .some((node) => node?.id === 'grown'),
        `expected the grown item, got ${JSON.stringify(afterNavigating)}`
      );
      assert.match((await reader.state(3)).url, /\/next$/);
    });

    it('should put everything that happened on one ordered timeline', async () => {
      const trace = await record();

      // One interaction goes through the commander, because an interaction
      // event is a record of what Browser Commander was asked to do. The
      // rest drive the page directly: they are about what the page did.
      //
      // That one interaction costs about 30 seconds, and the cost is the
      // factory's own configuration rather than anything this trace does:
      // the `page.goto` above put the navigation manager into its external
      // navigation wait, and a commander action joins that wait, which asks
      // the network tracker for idle with the factory's `idleTimeout` of
      // 30000ms - the window the network must stay quiet for. Changing that
      // number would change what every caller's readiness means, so it is
      // left alone and paid for here, once.
      await commander.click({
        selector: '#log',
        waitForNavigation: false,
        waitAfterClick: 0,
      });
      await page.click('#boom');
      await page.click('#unreachable');
      await page.click('#ask');
      const artifact = await downloads.capture({
        action: () => page.click('#download'),
        timeout: 20000,
      });
      await page.goto(`${server.baseUrl}/next`);
      const events = await waitForEvents(trace, [
        TRACE_EVENT.INTERACTION,
        TRACE_EVENT.CONSOLE,
        TRACE_EVENT.PAGE_ERROR,
        TRACE_EVENT.REQUEST_FAILED,
        TRACE_EVENT.DIALOG,
        TRACE_EVENT.DOWNLOAD,
        TRACE_EVENT.NAVIGATION,
      ]);
      await trace.stop();

      assert.deepStrictEqual(
        events.map((event) => event.sequence),
        events.map((_event, index) => index + 1)
      );
      const byKind = (kind) => events.filter((event) => event.kind === kind);
      assert.strictEqual(byKind(TRACE_EVENT.INTERACTION)[0].target, '#log');
      assert.match(byKind(TRACE_EVENT.CONSOLE)[0].text, /something happened/);
      assert.match(
        byKind(TRACE_EVENT.PAGE_ERROR)[0].message,
        /page error on purpose/
      );
      assert.match(
        byKind(TRACE_EVENT.REQUEST_FAILED)[0].url,
        /127\.0\.0\.1:1\/nope/
      );
      assert.strictEqual(
        byKind(TRACE_EVENT.DIALOG)[0].message,
        'are you sure?'
      );
      // The download is on the timeline by reference: the bytes stay where
      // the download manager put them, and the trace says where that is.
      const completed = byKind(TRACE_EVENT.DOWNLOAD).find(
        (event) => event.phase === 'completed'
      );
      assert.strictEqual(completed.path, artifact.path);
      assert.strictEqual(completed.checksum, artifact.checksum);
      assert.ok(!Object.hasOwn(completed, 'contents'));
      assert.strictEqual(
        await fs.readFile(completed.path, 'utf8'),
        TRACE_DOWNLOAD_BODY
      );
    });

    it('should keep a secret the page held out of every member', async () => {
      // No privacy options: a password is a secret by default, because a
      // trace nobody configured is the one most likely to be shared.
      const trace = await record({ screenshots: 'checkpoints' });

      await commander.fill({ selector: '#password', text: TRACE_SECRET });
      await trace.checkpoint('after typing the password');
      const stopped = await trace.stop();
      await writeTraceViewer(stopped.path);

      let checked = 0;
      for (const entry of await fs.readdir(stopped.path, {
        recursive: true,
        withFileTypes: true,
      })) {
        if (!entry.isFile()) {
          continue;
        }
        const body = await fs.readFile(
          path.join(entry.parentPath ?? entry.path, entry.name),
          'latin1'
        );
        assert.ok(
          !body.includes(TRACE_SECRET),
          `${entry.name} carries the secret`
        );
        checked += 1;
      }
      assert.ok(checked >= 4, `expected a full bundle, checked ${checked}`);
      const controls = controlsOf(
        await (await readTrace(stopped.path)).state(1)
      );
      assert.strictEqual(controls.get('#password').redacted, true);
      assert.strictEqual(controls.get('#password').value, '[redacted]');
    });

    it('should leave a readable trace when the page closes mid-run', async () => {
      const second = await browser.newPage();
      await second.goto(`${server.baseUrl}/`);
      // No commander: a consumer can trace any page, and this one is going to
      // be taken away while the recorder is still running.
      const trace = await startTrace({
        page: second,
        output: path.join(artifacts, `closed-${++runs}`),
        screenshots: false,
      });

      await trace.checkpoint('still open');
      await second.close();
      await trace.checkpoint('after the page went away');
      const stopped = await trace.stop();

      const reader = await readTrace(stopped.path);
      assert.strictEqual(reader.manifest.outcome, TRACE_OUTCOME.PARTIAL);
      // The first checkpoint survives the second one failing: a partial trace
      // is readable, not a corrupted run.
      assert.match(await reader.html(1), /Traced app/);
      const dropped = reader.events.find(
        (event) => event.kind === TRACE_EVENT.DROPPED
      );
      assert.ok(
        [
          TRACE_DROP_REASON.PAGE_CLOSED,
          TRACE_DROP_REASON.CAPTURE_FAILED,
        ].includes(dropped.reason),
        `unexpected reason ${dropped.reason}`
      );
    });

    it('should leave a viewer that opens with no network and replays the run', async () => {
      const trace = await record({ mode: TRACE_MODE.CONTINUOUS });
      await recordAnAppUpdate(trace);
      const stopped = await trace.stop();

      const viewer = await writeTraceViewer(stopped.path);
      assert.strictEqual(viewer, path.join(stopped.path, TRACE_FILES.VIEWER));
      const requested = [];
      const onRequest = (request) => requested.push(request.url());
      page.on('request', onRequest);
      await page.goto(`file://${viewer}`);

      const shown = await page.evaluate(() => ({
        events: document.querySelectorAll('#timeline li').length,
        step: document.getElementById('step').textContent,
        details: document.getElementById('details').textContent,
        framed: document.getElementById('stage').getAttribute('srcdoc'),
      }));
      assert.ok(shown.events > 0, 'the timeline is empty');
      assert.match(shown.details, /Traced app/);
      assert.match(shown.step, /[1-9]\d* mutation batches/);
      assert.match(shown.framed, /id="items"/);

      // Stepping replays the recorded mutations into the captured document.
      await page.click('#step-forward');
      await page.click('#step-forward');
      const replayed = await page.evaluate(() => ({
        step: document.getElementById('step').textContent,
        framed: document.getElementById('stage').getAttribute('srcdoc'),
      }));
      assert.match(replayed.step, /batch \d+ of \d+/);
      assert.match(replayed.framed, /id="item-1"|data-state="touched"/);
      page.off('request', onRequest);
      // Opening a colleague's trace must not call anyone's server.
      assert.deepStrictEqual(
        requested.filter((url) => /^https?:/.test(url)),
        []
      );
    });
  });
}

describe(
  'E2E - privacy-aware portable traces (issue #87)',
  { skip: !process.env.RUN_E2E, timeout: 600000 },
  () => {
    for (const engine of ENGINES) {
      describeTraces(engine);
    }
  }
);
