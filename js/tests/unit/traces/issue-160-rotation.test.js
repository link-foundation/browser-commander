import { it } from 'node:test';
import { openTraceBundle } from '../../../src/traces/bundle.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startTrace } from '../../../src/traces/recorder.js';
import { readTrace } from '../../../src/traces/reader.js';
import {
  createFakePage,
  createFakeCommander,
} from '../../helpers/trace-fixtures.js';

function assertUniqueIncreasingSequences(events) {
  const sequences = events.map((event) => event.sequence);
  assert.deepEqual(
    sequences,
    [...new Set(sequences)].sort((a, b) => a - b)
  );
}

it('rotates before oversized checkpoints and retains every segment by default', async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'bc-rotation-'));
  const page = createFakePage({
    snapshot: {
      html: `<div>${'payload'.repeat(1500)}</div>`,
      state: { url: 'https://example.test' },
    },
  });
  try {
    const trace = await startTrace({
      commander: createFakeCommander(page),
      output,
      screenshots: false,
      links: { output: path.join(output, 'trace.lino'), dom: 'full' },
      limits: { rotate: { maxBytes: 2048 } },
    });
    assert.equal(trace.links, path.join(output, 'trace.lino'));
    for (let i = 0; i < 8; i++) {
      await trace.checkpoint(`snapshot-${i}`);
      await trace.event('step', { payload: 'x'.repeat(1500), i });
    }
    await trace.stop();
    assert.equal(trace.stopped, true);
    const opened = await readTrace(trace.path);
    assert.equal(opened.events.filter((e) => e.action === 'step').length, 8);
    assert.equal(opened.events.filter((e) => e.kind === 'dropped').length, 0);
    assert.ok(opened.checkpoints.length >= 8);
    assert.match(await opened.html(opened.checkpoints[0].index), /payload/);
    assert.match(await fs.readFile(trace.links, 'utf8'), /dom-snapshot/);
    assert.ok(
      JSON.parse(await fs.readFile(path.join(output, 'segments.json'), 'utf8'))
        .segments.length > 4
    );
  } finally {
    await fs.rm(output, { recursive: true, force: true });
  }
});

it('automatically rotates continuous traces instead of permanently dropping later events', async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'bc-continuous-'));
  try {
    const trace = await startTrace({
      commander: createFakeCommander(createFakePage()),
      output,
      mode: 'continuous',
      screenshots: false,
      limits: { maxBundleBytes: 2048 },
    });
    for (let i = 0; i < 12; i++) {
      await trace.event('step', { i, payload: 'x'.repeat(1500) });
    }
    await trace.stop();
    const opened = await readTrace(output);
    assert.equal(opened.events.filter((e) => e.action === 'step').length, 12);
    assert.equal(opened.events.filter((e) => e.kind === 'dropped').length, 0);
    assertUniqueIncreasingSequences(opened.events);
  } finally {
    await fs.rm(output, { recursive: true, force: true });
  }
});

it('caps mutation intervals with a marker and records the next interval', async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'bc-interval-'));
  const bundle = await openTraceBundle({
    output,
    limits: { maxMutationBytes: 512 },
  });
  try {
    await bundle.writeMutations(1, [
      { records: [{ kind: 'attribute', value: 'a' }] },
      { records: [{ value: 'x'.repeat(1000) }] },
    ]);
    assert.equal(bundle.mutationTruncated, true);
    assert.equal(await bundle.writeMutations(1, [{ records: [] }]), null);
    const first = await fs.readFile(
      path.join(output, 'mutations/0001.ndjson'),
      'utf8'
    );
    assert.ok(Buffer.byteLength(first) <= 512);
    assert.match(first, /truncated/);
    await bundle.writeMutations(2, [
      { records: [{ kind: 'attribute', value: 'next' }] },
    ]);
    assert.equal(bundle.mutationTruncated, false);
    assert.match(
      await fs.readFile(path.join(output, 'mutations/0002.ndjson'), 'utf8'),
      /next/
    );
  } finally {
    await bundle.abort();
    await fs.rm(output, { recursive: true, force: true });
  }
});

it('keeps timeline sequences unique across drops and rotation', async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'bc-drop-rotation-'));
  try {
    const trace = await startTrace({
      commander: createFakeCommander(createFakePage()),
      output,
      mode: 'continuous',
      initialCheckpoint: false,
      screenshots: false,
      limits: { maxBundleBytes: 4096, maxEventBytes: 1024 },
    });
    await trace.event('oversized', { payload: 'x'.repeat(2000) });
    for (let i = 0; i < 8; i++) {
      await trace.event('step', { i, payload: 'x'.repeat(300) });
    }
    await trace.stop();
    const opened = await readTrace(output);
    assert.equal(opened.events.filter((e) => e.kind === 'dropped').length, 1);
    assert.equal(opened.events.filter((e) => e.action === 'step').length, 8);
    assert.ok(trace.segments.length > 1);
    assertUniqueIncreasingSequences(opened.events);
  } finally {
    await fs.rm(output, { recursive: true, force: true });
  }
});
