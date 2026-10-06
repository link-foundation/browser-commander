import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { closeServer, startFixtureHost } from '../../helpers/fixture-server.js';

/**
 * Open a connection the way a browser preconnects: TCP only, no request.
 * Node 24's http.Server#close() waits for such a socket until the client
 * drops it, which is what stalled the Safari smoke cleanup (issue #128).
 */
async function preconnect(url) {
  const { hostname, port } = new URL(url);
  const socket = connect(Number(port), hostname);
  socket.on('error', () => {});
  await new Promise((resolve) => socket.once('connect', resolve));
  return socket;
}

/** Fail instead of hanging when a close does not finish in time. */
function within(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`did not close within ${ms}ms`)),
        ms
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

describe('fixture server shutdown', { timeout: 10_000 }, () => {
  it('closeServer does not wait for a preconnected idle socket', async () => {
    const server = createServer((_request, response) => response.end('ok'));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const socket = await preconnect(
      `http://127.0.0.1:${server.address().port}/`
    );
    try {
      await within(closeServer(server), 2_000);
      assert.equal(server.listening, false);
    } finally {
      socket.destroy();
    }
  });

  it('startFixtureHost close does not wait for a preconnected idle socket', async () => {
    const host = await startFixtureHost((_path, _request, response) =>
      response.end('ok')
    );
    const socket = await preconnect(host.baseUrl);
    try {
      await within(host.close(), 2_000);
    } finally {
      socket.destroy();
    }
  });
});
