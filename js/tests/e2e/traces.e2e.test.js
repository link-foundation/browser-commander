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

    /**
     * Every mutation record a stopped trace holds, whichever interval it fell in.
     *
     * @param {Object} reader - An open trace
     * @returns {Promise<Object[]>} The records, in order
     */
    const allChanges = async (reader) => {
      const records = [];
      for (let index = 0; index <= reader.checkpoints.length; index++) {
        records.push(...changesIn(await reader.mutations(index)));
      }
      return records;
    };

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
      // A continuous trace takes its own base snapshot first (issue #93), so
      // the interval a moment belongs to is looked up by that moment's name
      // rather than counted from the caller's first checkpoint.
      const indexOf = (name) =>
        stopped.checkpoints.find((entry) => entry.name === name).index;
      const batches = await reader.mutations(indexOf('loaded'));
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
      const afterNavigating = await reader.mutations(
        indexOf('the next document')
      );
      assert.ok(
        changesIn(afterNavigating)
          .flatMap((change) => change.added ?? [])
          .some((node) => node?.id === 'grown'),
        `expected the grown item, got ${JSON.stringify(afterNavigating)}`
      );
      assert.match(
        (await reader.state(indexOf('the next document'))).url,
        /\/next$/
      );
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

    it('should record what a new document did while it was still loading', async () => {
      const trace = await record({ mode: TRACE_MODE.CONTINUOUS });

      // No checkpoint between the navigation and the change: the recorder has
      // to already be in the new document when the document's own script runs,
      // which is the interval issue #93 says used to be lost entirely.
      await page.goto(`${server.baseUrl}/init`);
      await trace.checkpoint('the new document initialized itself');
      const stopped = await trace.stop();

      const reader = await readTrace(stopped.path);
      const records = await allChanges(reader);
      const built = records.find((change) =>
        (change.added ?? []).some(
          (node) =>
            node?.id === 'made-while-loading' ||
            /made-while-loading/.test(node?.html ?? '')
        )
      );
      assert.ok(
        built,
        `no initialization mutation among ${records.length} records`
      );
      const marked = records.find(
        (change) =>
          change.kind === 'attributes' &&
          change.attribute === 'data-initialized'
      );
      assert.strictEqual(marked?.after, 'yes');
    });

    it('should record live control state as it changes, not only at checkpoints', async () => {
      const trace = await record({ mode: TRACE_MODE.CONTINUOUS });

      await page.click('#name');
      await page.type('#name', 'ada');
      await page.click('#terms');
      await choose('#plan', 'pro');
      await commander.evaluate(() => window.scrollTo(0, 400));
      // A scroll event is dispatched after the scroll, not during it, so the
      // checkpoint that drains the queue waits for a frame to be painted.
      await commander.evaluate(
        () =>
          new Promise((resolve) => {
            window.requestAnimationFrame(() =>
              window.requestAnimationFrame(() => resolve(true))
            );
          })
      );
      await trace.checkpoint('the form was filled in');
      const stopped = await trace.stop();

      const reader = await readTrace(stopped.path);
      const live = (await allChanges(reader)).filter(
        (change) => change.kind === 'live-state'
      );
      const properties = new Set(live.map((change) => change.property));
      for (const property of [
        'value',
        'checked',
        'selected',
        'focus',
        'scroll',
      ]) {
        assert.ok(
          properties.has(property),
          `no ${property} record among ${[...properties].join(', ')}`
        );
      }

      // Each keystroke is its own state: a stepwise replay of typing has to be
      // able to show "a", then "ad", then "ada".
      const typed = live.filter(
        (change) =>
          change.property === 'value' && change.target?.path === '#name'
      );
      assert.deepStrictEqual(
        typed.map((change) => change.after),
        ['a', 'ad', 'ada']
      );
      const checked = live.find((change) => change.property === 'checked');
      assert.strictEqual(checked.after, true);
      const selected = live.find((change) => change.property === 'selected');
      assert.deepStrictEqual(selected.after, ['pro']);
      const scrolled = live
        .filter((change) => change.property === 'scroll')
        .pop();
      assert.strictEqual(scrolled.after.top, 400);
    });

    it('should replay an insertion, a move, a removal and a replacement exactly', async () => {
      const trace = await record({ mode: TRACE_MODE.CONTINUOUS });

      await page.click('#insert-first');
      await page.click('#move-last');
      await page.click('#remove-one');
      await page.click('#replace-subtree');
      const settled = await trace.checkpoint('the list settled');
      const stopped = await trace.stop();
      const viewer = await writeTraceViewer(stopped.path);

      await page.goto(`file://${viewer}`);
      const batches = await page.evaluate(
        () =>
          JSON.parse(document.getElementById('trace-data').textContent)
            .mutations[1].length
      );
      assert.ok(batches > 0, 'the interval recorded nothing to replay');
      for (let step = 0; step < batches; step++) {
        await page.click('#step-forward');
      }

      // Both documents reach the comparison as strings this test holds: the
      // replayed one read out of the frame, the recorded one read from the
      // bundle on disk. Taking text straight back out of the page and parsing
      // it as HTML in the same breath is what CodeQL reports as
      // `js/xss-through-dom` (alert 20 on this pull request), and reading the
      // recorded side from the bundle is the stronger check anyway: it holds
      // the viewer to the file it was built from rather than to the copy it
      // embedded in itself.
      const replayedHtml = await page.evaluate(() =>
        document.getElementById('stage').getAttribute('srcdoc')
      );
      const capturedHtml = await (
        await readTrace(stopped.path)
      ).html(settled.index);
      assert.ok(capturedHtml, 'the bundle kept no HTML for the checkpoint');

      const compared = await page.evaluate(
        ([replayedSource, capturedSource]) => {
          // The viewer highlights what it touched and annotates what a static
          // document cannot show; neither is part of the recorded DOM.
          const clean = (source) => {
            const parsed = new DOMParser().parseFromString(source, 'text/html');
            for (const element of parsed.querySelectorAll('*')) {
              element.removeAttribute('style');
              for (const attribute of [...element.attributes]) {
                if (attribute.name.startsWith('data-bc-')) {
                  element.removeAttribute(attribute.name);
                }
              }
            }
            return parsed;
          };
          const replayed = clean(replayedSource);
          const captured = clean(capturedSource);
          const sub = (parsed, selector) =>
            parsed.querySelector(selector)?.innerHTML.trim() ?? null;
          return {
            items: [sub(replayed, '#items'), sub(captured, '#items')],
            subtree: [sub(replayed, '#subtree'), sub(captured, '#subtree')],
          };
        },
        [replayedHtml, capturedHtml]
      );

      assert.strictEqual(compared.items[0], compared.items[1]);
      assert.strictEqual(compared.subtree[0], compared.subtree[1]);
      assert.match(compared.items[1], /id="item-b"[\s\S]*id="inserted"/);
      assert.doesNotMatch(compared.items[1], /id="item-a"/);
      assert.match(compared.subtree[1], /id="new-child"/);
    });

    it('should resolve every record to one unambiguous page and frame', async () => {
      const second = await browser.newPage();
      await second.goto(`${server.baseUrl}/`);
      const here = await record({ mode: TRACE_MODE.CONTINUOUS });
      const there = await startTrace({
        page: second,
        output: path.join(artifacts, `owners-${++runs}`),
        screenshots: false,
        mode: TRACE_MODE.CONTINUOUS,
      });

      // Opening a second tab pushes the first into the background, where
      // requestAnimationFrame stops firing and Puppeteer's click, which waits
      // for the element to settle, never returns. Whichever page is being
      // driven is the one in front.
      await page.bringToFront();
      await page.click('#add');
      await second.bringToFront();
      await second.click('#add');
      await page.bringToFront();
      // A change inside the iframe, so this run holds two documents of one page
      // as well as two pages of one browser.
      await commander.evaluate(() => {
        const framed = document.getElementById('inner').contentDocument;
        framed.body.appendChild(framed.createElement('span'));
      });
      await here.checkpoint('both pages moved');
      await there.checkpoint('both pages moved');
      const stoppedHere = await here.stop();
      const stoppedThere = await there.stop();
      await second.close();

      const readHere = await readTrace(stoppedHere.path);
      const readThere = await readTrace(stoppedThere.path);
      const pagesOf = (events) => new Set(events.map((event) => event.pageId));
      assert.strictEqual(pagesOf(readHere.events).size, 1);
      assert.strictEqual(pagesOf(readThere.events).size, 1);
      assert.notStrictEqual(
        [...pagesOf(readHere.events)][0],
        [...pagesOf(readThere.events)][0]
      );
      for (const event of [...readHere.events, ...readThere.events]) {
        assert.ok(event.traceId, `an event with no trace: ${event.kind}`);
        assert.ok(
          event.navigationId,
          `an event with no document: ${event.kind}`
        );
      }

      const batches = [];
      for (let index = 0; index <= readHere.checkpoints.length; index++) {
        batches.push(...(await readHere.mutations(index)));
      }
      assert.ok(
        batches.every(
          (batch) => batch.frameId && batch.pageId && batch.traceId
        ),
        'a batch arrived without an owner'
      );
      assert.ok(
        batches.some((batch) => batch.mainFrame === false),
        'nothing was recorded inside the iframe'
      );
      assert.ok(
        new Set(batches.map((batch) => batch.frameId)).size >= 2,
        'the page and its iframe reported the same frame'
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

      // The viewer opens on the run's base snapshot, and nothing happened
      // before it by definition (issue #93), so the interval with the app's
      // changes in it is the one that starts at the checkpoint named here.
      const selected = await page.evaluate(() => {
        const entry = [...document.querySelectorAll('#timeline li')].find(
          (li) => li.querySelector('.what').textContent === 'loaded'
        );
        if (!entry) {
          return false;
        }
        entry.click();
        return true;
      });
      assert.ok(selected, 'the timeline has no checkpoint named "loaded"');

      const shown = await page.evaluate(() => ({
        events: document.querySelectorAll('#timeline li').length,
        step: document.getElementById('step').textContent,
        details: document.getElementById('details').textContent,
        replay: document.querySelector('.meta.replay').textContent,
        framed: document.getElementById('stage').getAttribute('srcdoc'),
      }));
      assert.ok(shown.events > 0, 'the timeline is empty');
      assert.match(shown.details, /Traced app/);
      assert.match(shown.step, /[1-9]\d* mutation batches/);
      assert.match(shown.framed, /id="items"/);
      // The viewer says what it can and cannot reproduce rather than implying
      // the recording is the whole run (issue #93).
      assert.match(shown.replay, /partial diagnostic replay/);
      assert.match(shown.replay, /live control state/);

      // Stepping replays the recorded mutations into the captured document.
      // One step is one batch, and a click reports the focus and the scroll it
      // caused as well as what it changed in the DOM (issue #93), so the run's
      // changes are reached by stepping to the end of the interval rather than
      // by assuming which batch they landed in.
      const batches = Number(shown.step.match(/^(\d+) mutation batches$/)[1]);
      assert.ok(batches > 0, `nothing to step through: ${shown.step}`);
      let replayed = null;
      for (let step = 0; step < batches; step++) {
        await page.click('#step-forward');
        replayed = await page.evaluate(() => ({
          step: document.getElementById('step').textContent,
          framed: document.getElementById('stage').getAttribute('srcdoc'),
        }));
        assert.match(replayed.step, /batch \d+ of \d+/);
      }
      assert.match(replayed.framed, /id="item-1"/);
      assert.match(replayed.framed, /data-state="touched"/);
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
