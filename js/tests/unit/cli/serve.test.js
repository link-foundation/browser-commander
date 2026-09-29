import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PassThrough } from 'node:stream';

import { createDispatcher } from '../../../src/cli/dispatcher.js';
import {
  createMessageHandler,
  handleLine,
  serveStdio,
} from '../../../src/cli/serve.js';
import { createFakeDependencies } from '../../helpers/cli-fakes.js';

function handler() {
  const { dependencies } = createFakeDependencies();
  return createMessageHandler(createDispatcher({ dependencies }));
}

describe('JSON-RPC message handling', () => {
  it('answers a request with its id', async () => {
    const response = await handler()({
      jsonrpc: '2.0',
      id: 7,
      method: 'version',
    });

    assert.equal(response.id, 7);
    assert.equal(response.result.name, 'browser-commander');
  });

  it('maps errors to the contract codes', async () => {
    const handle = handler();

    assert.deepEqual(await handle({ jsonrpc: '2.0', id: 1, method: 'nope' }), {
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32601, message: 'Unknown method: nope' },
    });
    const invalid = await handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'page.goto',
    });
    assert.equal(invalid.error.code, -32602);
    assert.deepEqual(await handle({ id: 3, method: 'version' }), {
      jsonrpc: '2.0',
      id: 3,
      error: { code: -32600, message: 'Invalid request' },
    });
    const engine = await handle({
      jsonrpc: '2.0',
      id: 4,
      method: 'session.connect',
      params: {},
    });
    assert.equal(engine.error.code, -32602);
  });

  it('reports engine failures as -32000 with the error name', async () => {
    const { dependencies } = createFakeDependencies();
    dependencies.launchBrowser = async () => {
      throw new TypeError('no browser here');
    };
    const handle = createMessageHandler(createDispatcher({ dependencies }));

    const response = await handle({
      jsonrpc: '2.0',
      id: 'a',
      method: 'session.launch',
    });

    assert.equal(response.error.code, -32000);
    assert.equal(response.error.message, 'no browser here');
    assert.equal(response.error.data.name, 'TypeError');
  });

  it('does not answer notifications and supports batches', async () => {
    const handle = handler();

    assert.equal(await handle({ jsonrpc: '2.0', method: 'version' }), null);
    const batch = await handle([
      { jsonrpc: '2.0', id: 1, method: 'version' },
      { jsonrpc: '2.0', method: 'version' },
      { jsonrpc: '2.0', id: 2, method: 'nope' },
    ]);
    assert.deepEqual(
      batch.map((response) => response.id),
      [1, 2]
    );
    assert.equal((await handle([])).error.code, -32600);
  });

  it('answers unparsable lines with -32700 and skips blank ones', async () => {
    const handle = handler();

    const response = await handleLine('{not json', handle);

    assert.equal(response.id, null);
    assert.equal(response.error.code, -32700);
    assert.equal(await handleLine('   ', handle), null);
  });
});

/** Start a server on a PassThrough stdin and collect what it writes. */
function startServer(dependencies, options = {}) {
  const input = new PassThrough();
  const lines = [];
  const served = serveStdio({
    input,
    write: (text) => lines.push(JSON.parse(text)),
    dependencies,
    ...options,
  });
  return { input, lines, served };
}

describe('serveStdio', () => {
  it('serves line-delimited requests and closes sessions when stdin ends', async () => {
    const { dependencies, launches, pages } = createFakeDependencies();
    const { input, lines, served } = startServer(dependencies);

    const request = (id, method, params) =>
      input.write(
        `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`
      );
    request(1, 'session.launch', { headless: true });
    await new Promise((resolve) => setTimeout(resolve, 10));
    request(2, 'handle.root', { name: 'session:s1' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    request(3, 'events.subscribe', { handle: 'h3', event: 'console' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    pages[0].emit('console', 'hi');
    request(4, 'bogus');
    input.end();
    await served;

    const byId = Object.fromEntries(
      lines.filter((line) => 'id' in line).map((line) => [line.id, line])
    );
    assert.equal(byId[1].result.session, 's1');
    assert.equal(byId[2].result.page.$handle, 'h3');
    assert.equal(byId[3].result.subscription, 'e1');
    assert.equal(byId[4].error.code, -32601);
    assert.deepEqual(
      lines.find((line) => line.method === 'events.emit'),
      {
        jsonrpc: '2.0',
        method: 'events.emit',
        params: { subscription: 'e1', args: ['hi'] },
      }
    );
    assert.equal(launches[0].closed, true);
  });

  it('stops waiting for a stuck request after the drain timeout', async () => {
    const { dependencies } = createFakeDependencies();
    dependencies.packageInfo = () => new Promise(() => {});
    const { input, lines, served } = startServer(dependencies, {
      drainTimeoutMs: 20,
    });
    input.end(
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'version' })}\n`
    );
    await served;

    assert.deepEqual(lines, []);
  });
});
