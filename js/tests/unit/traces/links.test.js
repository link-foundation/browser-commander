import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Parser } from 'links-notation';

import { openTraceBundle } from '../../../src/traces/bundle.js';
import { readTrace } from '../../../src/traces/reader.js';
import { startTrace } from '../../../src/traces/recorder.js';
import {
  decodeLinkText,
  encodeLinkText,
  formatTraceLinks,
  timelineLink,
  traceLinks,
  TRACE_LINKS_SECTIONS,
  TRACE_LINKS_VERSION,
  writeTraceLinks,
} from '../../../src/traces/links.js';
import {
  createManifest,
  TRACE_EVENT,
  TRACE_MODE,
} from '../../../src/traces/schema.js';
import {
  createFakeCommander,
  createFakePage,
  makeSnapshot,
  useTempTraceDirectory,
  useTraceBundleCleanup,
} from '../../helpers/trace-fixtures.js';

/**
 * The fields of one exported link, by name.
 *
 * @param {Object} link - A link parsed out of an export
 * @returns {Object} `{name: value}` for every pair the link holds
 */
function fieldsOf(link) {
  const fields = {};
  for (const value of link.values ?? []) {
    fields[value.id] = decodeLinkText(
      (value.values ?? []).map((inner) => inner.id).join(' ')
    );
  }
  return fields;
}

/**
 * Parse an export back into links, one per line.
 *
 * @param {string} text - The contents of an export
 * @returns {Object[]} `{id, fields}` per link, in file order
 */
function parseExport(text) {
  const lines = text.split('\n').filter((line) => line !== '');
  return lines.map((line) => {
    const parsed = new Parser().parse(line);
    assert.strictEqual(
      parsed.length,
      1,
      `a line held ${parsed.length} links: ${line}`
    );
    return { id: parsed[0].id, fields: fieldsOf(parsed[0]) };
  });
}

describe('trace links export (issue #94)', () => {
  const directory = useTempTraceDirectory();
  const trackOpenBundle = useTraceBundleCleanup();

  /**
   * Write a bundle holding one of everything the export has to say.
   *
   * @param {Object} [options] - `{close}`
   * @returns {Promise<string>} Path to the bundle
   */
  const writeBundle = async ({ close = true } = {}) => {
    const root = path.join(directory.path, 'run.bc-trace');
    const bundle = await openTraceBundle({ output: root });
    trackOpenBundle(bundle);
    const owner = {
      traceId: 'trace-1',
      browserContextId: 'context-1',
      pageId: 'page-1',
      navigationId: 'nav-1',
    };

    await bundle.appendEvent({
      kind: TRACE_EVENT.TRACE_START,
      ...owner,
      mode: TRACE_MODE.CONTINUOUS,
      engine: 'playwright',
    });

    const first = await bundle.writeCheckpoint({
      index: 1,
      html: '<html><body>one</body></html>',
      state: {
        url: 'https://example.com/one',
        controls: [
          { path: '#name', value: '' },
          { path: '#terms', value: 'on', checked: false },
        ],
      },
      screenshot: Buffer.from('fake-png-bytes'),
    });
    await bundle.appendEvent({
      kind: TRACE_EVENT.CHECKPOINT,
      ...owner,
      index: 1,
      name: 'loaded',
      actor: 'recorder',
      reason: 'initial',
      url: 'https://example.com/one',
      members: first,
    });

    await bundle.appendEvent({
      kind: TRACE_EVENT.INTERACTION,
      ...owner,
      actionId: 'trace-1-action-1',
      action: 'click',
      target: "#name[data-label='it\\'s here']",
      durationMs: 12,
      ok: true,
    });
    await bundle.appendEvent({
      kind: TRACE_EVENT.CONSOLE,
      ...owner,
      level: 'log',
      text: 'first line\nsecond line',
    });
    await bundle.appendEvent({
      kind: TRACE_EVENT.INTERACTION,
      ...owner,
      action: 'click',
      target: '#missing',
      ok: false,
      error: 'no element matched',
    });
    const member = await bundle.writeMutations(1, [
      { records: [{ kind: 'childList' }] },
    ]);
    await bundle.appendEvent({
      kind: TRACE_EVENT.MUTATIONS,
      ...owner,
      member,
      batches: 1,
      checkpoint: 1,
      frames: 1,
    });
    await bundle.drop({
      reason: 'size-limit',
      member: 'checkpoints/2',
      detail: '99 bytes',
    });

    const second = await bundle.writeCheckpoint({
      index: 2,
      html: '<html><body>two</body></html>',
      state: {
        url: 'https://example.com/two',
        controls: [
          { path: '#name', value: 'ada' },
          { path: '#terms', value: 'on', checked: true },
        ],
      },
    });
    await bundle.appendEvent({
      kind: TRACE_EVENT.CHECKPOINT,
      ...owner,
      index: 2,
      name: 'filled in',
      actor: 'automation',
      reason: 'checkpoint',
      url: 'https://example.com/two',
      members: second,
    });

    if (close) {
      await bundle.close(
        createManifest({
          mode: TRACE_MODE.CONTINUOUS,
          engine: 'playwright',
          startedAt: '2026-01-01T00:00:00.000Z',
          stoppedAt: '2026-01-01T00:00:10.000Z',
        })
      );
    }
    return root;
  };

  /**
   * Export a bundle and read the result back.
   *
   * @param {string} root - Path to the bundle
   * @param {Object} [options] - `{include}`
   * @returns {Promise<Object>} `{file, text, links}`
   */
  const exported = async (root, options = {}) => {
    const file = await writeTraceLinks(
      await readTrace(root),
      path.join(directory.path, 'run.lino'),
      options
    );
    const text = await fs.readFile(file, 'utf8');
    return { file, text, links: parseExport(text) };
  };

  it('should write one link per timeline event, in the order they happened', async () => {
    const root = await writeBundle();
    const { links } = await exported(root);
    const { events } = await readTrace(root);

    const timeline = links.filter((link) => link.id === 'timeline');
    assert.strictEqual(timeline.length, events.length);
    assert.deepStrictEqual(
      timeline.map((link) => Number(link.fields.sequence)),
      events.map((event) => event.sequence)
    );

    const click = timeline.find(
      (link) => link.fields.action === 'click' && link.fields.outcome === 'ok'
    );
    // Everything issue #94 asks a timeline link to answer: when, what kind,
    // whose, who did it, what it did, to what, and how it went.
    assert.ok(Number(click.fields.sequence) > 0);
    assert.match(click.fields.at, /^\d{4}-\d{2}-\d{2}T/);
    assert.strictEqual(click.fields.kind, TRACE_EVENT.INTERACTION);
    assert.strictEqual(click.fields.trace, 'trace-1');
    assert.strictEqual(click.fields.context, 'context-1');
    assert.strictEqual(click.fields.page, 'page-1');
    assert.strictEqual(click.fields.navigation, 'nav-1');
    assert.strictEqual(click.fields.actor, 'automation');
    assert.strictEqual(click.fields.target, "#name[data-label='it\\'s here']");
    assert.strictEqual(click.fields.actionId, 'trace-1-action-1');
  });

  it('should say which records failed, were dropped or are partial', async () => {
    const root = await writeBundle();
    const { links } = await exported(root);
    const outcomes = links
      .filter((link) => link.id === 'timeline')
      .map((link) => link.fields.outcome);

    assert.ok(outcomes.includes('ok'), 'no successful record is marked ok');
    assert.ok(
      outcomes.includes('failed'),
      'an interaction that threw is not marked failed'
    );
    const dropped = links.find(
      (link) => link.id === 'timeline' && link.fields.outcome === 'dropped'
    );
    // A gap has to be visible in the export, not only in the bundle.
    assert.strictEqual(dropped.fields.kind, TRACE_EVENT.DROPPED);
    assert.strictEqual(dropped.fields.reason, 'size-limit');
    assert.strictEqual(dropped.fields.target, 'checkpoints/2');

    const result = links.find((link) => link.id === 'result');
    assert.strictEqual(result.fields.outcome, 'partial');
    assert.strictEqual(result.fields.dropped, '1');
  });

  it('should point at checkpoint members instead of copying them', async () => {
    const root = await writeBundle();
    const { text, links } = await exported(root);
    const checkpoints = links.filter((link) => link.id === 'checkpoint');

    assert.strictEqual(checkpoints.length, 2);
    assert.strictEqual(checkpoints[0].fields.name, 'loaded');
    assert.strictEqual(checkpoints[0].fields.html, 'checkpoints/0001.html');
    assert.strictEqual(
      checkpoints[0].fields.state,
      'checkpoints/0001.state.json'
    );
    assert.strictEqual(
      checkpoints[0].fields.screenshot,
      'checkpoints/0001.png'
    );
    // The interval of mutations that starts at a checkpoint is named by its
    // own timeline link, which says which checkpoint it belongs to.
    const interval = links.find(
      (link) => link.fields.kind === TRACE_EVENT.MUTATIONS
    );
    assert.strictEqual(interval.fields.member, 'mutations/0001.ndjson');
    assert.strictEqual(interval.fields.checkpoint, '1');
    // A checkpoint that has no screenshot says so by not naming one.
    assert.strictEqual(checkpoints[1].fields.screenshot, undefined);

    // Every member reference is a path inside the bundle, and none of the
    // bytes behind those paths are in the export.
    for (const member of Object.values(checkpoints[0].fields)) {
      assert.ok(!path.isAbsolute(member), `${member} is not bundle-relative`);
    }
    assert.ok(
      !text.includes('fake-png-bytes'),
      'the export copied a screenshot instead of pointing at it'
    );
    assert.ok(
      !text.includes('<html>'),
      'the export copied captured markup instead of pointing at it'
    );
  });

  it('should write one link per control the run changed', async () => {
    const root = await writeBundle();
    const { links } = await exported(root);
    const diffs = links.filter((link) => link.id === 'control-diff');

    assert.deepStrictEqual(
      diffs.map((link) => link.fields.path),
      ['#name', '#terms']
    );
    const [name, terms] = diffs;
    assert.strictEqual(name.fields.before, '');
    assert.strictEqual(name.fields.after, 'ada');
    // Who made the change is part of the answer, and it is the actor of the
    // checkpoint the change is measured to.
    assert.strictEqual(name.fields.actor, 'automation');
    assert.strictEqual(name.fields.checkpoint, '2');
    assert.strictEqual(name.fields.previous, '1');
    assert.strictEqual(terms.fields.before, 'false');
    assert.strictEqual(terms.fields.after, 'true');
  });

  it('should write only the sections a caller asked for', async () => {
    const root = await writeBundle();
    const { links } = await exported(root, {
      include: ['timeline', 'checkpoints', 'control-diffs'],
    });
    const ids = new Set(links.map((link) => link.id));

    assert.deepStrictEqual(
      [...ids].sort(),
      ['checkpoint', 'control-diff', 'timeline'].sort()
    );

    const only = await exported(root, { include: ['checkpoints'] });
    assert.deepStrictEqual(
      [...new Set(only.links.map((link) => link.id))],
      ['checkpoint']
    );

    await assert.rejects(
      () => exported(root, { include: ['everything'] }),
      /unknown trace links section "everything"/
    );
  });

  it('should survive a round trip through a Links Notation parser', async () => {
    const root = await writeBundle();
    const { text, links } = await exported(root);

    // One link per line is what makes the export greppable and what makes a
    // half-written file readable up to its last full line.
    for (const line of text.split('\n').filter(Boolean)) {
      assert.ok(line.startsWith('('), `a line is not one link: ${line}`);
    }

    // A value holding a newline, a quote, or both, is the case the notation's
    // own escaping cannot read back, so the export encodes it reversibly.
    const console = links.find(
      (link) => link.fields.kind === TRACE_EVENT.CONSOLE
    );
    assert.strictEqual(console.fields.text, 'first line\nsecond line');

    for (const value of [
      'both\'and"',
      'line\nbreak',
      'tab\there',
      'back\\slash',
      '',
      '[redacted]',
      'plain',
    ]) {
      assert.strictEqual(decodeLinkText(encodeLinkText(value)), value);
    }
  });

  it('should keep the same secrets the bundle keeps', async () => {
    const page = createFakePage({
      snapshot: makeSnapshot({
        state: {
          controls: [
            {
              path: '#password',
              tag: 'input',
              type: 'password',
              value: 'hunter2',
            },
          ],
        },
      }),
    });
    const trace = await startTrace({
      commander: createFakeCommander(page),
      page,
      output: path.join(directory.path, 'private.bc-trace'),
      links: { output: path.join(directory.path, 'private.lino') },
    });
    await trace.checkpoint('signed in');
    const stopped = await trace.stop();

    const text = await fs.readFile(stopped.links, 'utf8');
    const bundleText = await fs.readFile(
      path.join(stopped.path, 'events.ndjson'),
      'utf8'
    );
    // The export cannot leak what the bundle redacted, because it only ever
    // reads what the bundle already wrote.
    assert.ok(!bundleText.includes('hunter2'));
    assert.ok(!text.includes('hunter2'));
  });

  it('should stream the same export the finished bundle produces', async () => {
    const page = createFakePage();
    const trace = await startTrace({
      commander: createFakeCommander(page),
      page,
      mode: TRACE_MODE.CONTINUOUS,
      output: path.join(directory.path, 'streamed.bc-trace'),
      links: { output: path.join(directory.path, 'streamed.lino') },
    });
    page.queueMutations([{ records: [{ kind: 'childList' }] }]);
    await trace.checkpoint('after the update');
    await trace.event('something the caller cared about');
    const stopped = await trace.stop();

    const streamed = await fs.readFile(stopped.links, 'utf8');
    const afterwards = await writeTraceLinks(
      await readTrace(stopped.path),
      path.join(directory.path, 'afterwards.lino')
    );

    // Streaming as the run happens and exporting the finished bundle are two
    // routes to one representation; if they could disagree, neither could be
    // trusted.
    assert.strictEqual(streamed, await fs.readFile(afterwards, 'utf8'));
    assert.ok(streamed.startsWith('(trace: '));
    assert.match(streamed, /\(result: /);
  });

  it('should leave a readable export when a run never stops', async () => {
    const page = createFakePage();
    const trace = await startTrace({
      commander: createFakeCommander(page),
      page,
      output: path.join(directory.path, 'killed.bc-trace'),
      links: { output: path.join(directory.path, 'killed.lino') },
    });
    await trace.checkpoint('as far as it got');

    // Nothing calls stop(), the way a killed process does not.
    const links = parseExport(await fs.readFile(trace.links, 'utf8'));
    assert.strictEqual(links[0].id, 'trace');
    assert.ok(
      links.some((link) => link.id === 'checkpoint'),
      'a checkpoint that was recorded is missing from the export'
    );
    // No closing link, which is how a reader tells this run never finished.
    assert.ok(!links.some((link) => link.id === 'result'));

    // The assertions above model the process being killed. The test process
    // itself survives, so release its open descriptor explicitly.
    await trace.stop();
  });

  it('should take the export away with a discarded bundle', async () => {
    const page = createFakePage();
    const output = path.join(directory.path, 'discarded.lino');
    const trace = await startTrace({
      commander: createFakeCommander(page),
      page,
      output: path.join(directory.path, 'discarded.bc-trace'),
      links: { output },
    });
    await trace.checkpoint('never kept');
    await trace.stop({ discard: true });

    await assert.rejects(() => fs.stat(output), { code: 'ENOENT' });
  });

  it('should refuse an export with nowhere to write', async () => {
    const page = createFakePage();
    await assert.rejects(
      () =>
        startTrace({
          commander: createFakeCommander(page),
          page,
          output: path.join(directory.path, 'nowhere.bc-trace'),
          links: {},
        }),
      /trace links require an output path/
    );
  });

  it('should write the representation this version pins', async () => {
    // A golden line, so a change to the shape of the export is a change to
    // this test rather than a surprise for whatever is reading the files.
    const text = formatTraceLinks([
      timelineLink({
        sequence: 7,
        at: '2026-01-01T00:00:03.000Z',
        monotonicMs: 1200,
        kind: TRACE_EVENT.INTERACTION,
        traceId: 'trace-1',
        browserContextId: 'context-1',
        pageId: 'page-1',
        navigationId: 'nav-2',
        actionId: 'trace-1-action-3',
        action: 'click',
        target: '#add',
        durationMs: 12,
        ok: true,
      }),
    ]);

    assert.strictEqual(
      text,
      "(timeline: (sequence: 7) (at: '2026-01-01T00:00:03.000Z') " +
        '(monotonicMs: 1200) (kind: interaction) (trace: trace-1) ' +
        '(context: context-1) (page: page-1) (navigation: nav-2) ' +
        "(actor: automation) (action: click) (target: '#add') (outcome: ok) " +
        '(actionId: trace-1-action-3) (durationMs: 12) (ok: true))\n'
    );
    assert.strictEqual(TRACE_LINKS_VERSION, 1);
    assert.deepStrictEqual(TRACE_LINKS_SECTIONS, [
      'trace',
      'timeline',
      'checkpoints',
      'control-diffs',
    ]);
  });

  it('should pin the Links Notation version it was written against', async () => {
    const read = async (file) =>
      JSON.parse(await fs.readFile(new URL(file, import.meta.url), 'utf8'));
    const manifest = await read('../../../package.json');
    const installed = await read(
      '../../../node_modules/links-notation/package.json'
    );

    // The notation's formatter and parser decide whether an export can be read
    // back, so the range this package depends on and the version the tests
    // proved are the same range.
    assert.strictEqual(manifest.dependencies['links-notation'], '^0.20.0');
    assert.match(installed.version, /^0\.20\./);
  });

  it('should export a bundle named by path as readily as an open one', async () => {
    const root = await writeBundle();
    const file = await writeTraceLinks(
      root,
      path.join(directory.path, 'by-path.lino')
    );
    const links = await traceLinks(root);

    assert.strictEqual(
      await fs.readFile(file, 'utf8'),
      formatTraceLinks(links)
    );
  });
});
