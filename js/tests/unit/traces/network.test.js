import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startTrace } from '../../../src/traces/recorder.js';
import { UnsupportedCaptureError } from '../../../src/capture/errors.js';
import {
  createFakeCommander,
  createFakePage,
} from '../../helpers/trace-fixtures.js';

async function networkFixture() {
  return {
    output: await fs.mkdtemp(path.join(os.tmpdir(), 'commander-network-')),
    page: createFakePage(),
  };
}

it('records filtered network metadata and bounded redacted bodies in HAR', async () => {
  const { output, page } = await networkFixture();
  try {
    const trace = await startTrace({
      commander: createFakeCommander(page),
      output,
      initialCheckpoint: false,
      network: {
        resourceTypes: ['fetch'],
        bodies: true,
        maxBodyBytes: 4,
        har: true,
      },
    });
    const request = {
      url: () => 'https://example.test/api',
      method: () => 'GET',
      resourceType: () => 'fetch',
      headers: () => ({
        authorization: 'secret',
        cookie: 'session',
        accept: 'text/plain',
      }),
      timing: () => ({ startTime: Date.now(), responseEnd: 10 }),
    };
    page.emit('request', request);
    page.emit('response', {
      request: () => request,
      url: request.url,
      status: () => 200,
      headers: () => ({ 'set-cookie': 'secret', 'content-type': 'text/plain' }),
      body: async () => Buffer.from('abcdef'),
    });
    await trace.stop();
    const events = await fs.readFile(
      path.join(output, 'events.ndjson'),
      'utf8'
    );
    assert.match(events, /network.response/);
    assert.doesNotMatch(events, /secret|session/);
    const har = JSON.parse(
      await fs.readFile(path.join(output, 'network.har'), 'utf8')
    );
    assert.equal(har.log.entries.length, 1);
    assert.equal(har.log.entries[0].response.content.text, 'abcd');
    assert.equal(har.log.entries[0].response.content._truncated, true);
  } finally {
    await fs.rm(output, { recursive: true, force: true });
  }
});

it('rejected video startup removes every installed observer', async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'commander-start-'));
  const page = createFakePage();
  const listeners = new Set();
  const evaluate = page.evaluate.bind(page);
  page.evaluate = (fn, argument) =>
    argument === 'mov' ? Promise.resolve(false) : evaluate(fn, argument);
  const on = page.on.bind(page);
  const off = page.off.bind(page);
  page.on = (event, listener) => {
    listeners.add(listener);
    return on(event, listener);
  };
  page.off = (event, listener) => {
    listeners.delete(listener);
    return off(event, listener);
  };
  try {
    await assert.rejects(
      startTrace({
        commander: createFakeCommander(page),
        output,
        links: { output: path.join(output, 'trace.lino') },
        video: { format: 'mov' },
        network: true,
      }),
      UnsupportedCaptureError
    );
    assert.equal(listeners.size, 0);
  } finally {
    await fs.rm(output, { recursive: true, force: true });
  }
});

it('omits binary bytes while preserving reported original size without buffering', async () => {
  const { output, page } = await networkFixture();
  try {
    const trace = await startTrace({
      commander: createFakeCommander(page),
      output,
      initialCheckpoint: false,
      network: { bodies: true, har: true },
    });
    const request = {
      url: () => 'https://example.test/binary',
      method: () => 'GET',
      resourceType: () => 'fetch',
      headers: () => ({}),
      sizes: async () => ({ responseBodySize: 1234 }),
    };
    page.emit('request', request);
    page.emit('response', {
      request: () => request,
      status: () => 200,
      headers: () => ({ 'content-type': 'application/octet-stream' }),
      body: async () => {
        assert.fail('binary body must not be buffered');
      },
    });
    await trace.stop();
    const events = (
      await fs.readFile(path.join(output, 'events.ndjson'), 'utf8')
    )
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.deepEqual(
      events.find((event) => event.kind === 'network.response').body,
      { size: 1234, omitted: 'binary' }
    );
    const har = JSON.parse(
      await fs.readFile(path.join(output, 'network.har'), 'utf8')
    );
    assert.equal(har.log.entries[0].response.content.size, 1234);
    assert.equal(har.log.entries[0].response.content.text, undefined);
  } finally {
    await fs.rm(output, { recursive: true, force: true });
  }
});
