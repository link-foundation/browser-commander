import { it } from 'node:test';
import assert from 'node:assert/strict';
import { closeRemoteBrowser } from '../../../src/browser/persistent-session.js';

function websocket(context) {
  const sockets = [];
  class Socket {
    constructor() {
      sockets.push(this);
      globalThis.queueMicrotask(() => this.onopen());
    }
    send(message) {
      this.request = JSON.parse(message);
    }
    close() {
      this.clientClosed = true;
      this.onclose();
    }
    message(value) {
      this.onmessage({ data: JSON.stringify(value) });
    }
  }
  function createSocket() {
    return new Socket();
  }
  context.mock.method(globalThis, 'WebSocket', createSocket);
  return sockets;
}

it('waits for browser shutdown rather than closing on unrelated CDP events', async (context) => {
  const sockets = websocket(context);
  const closing = closeRemoteBrowser('ws://127.0.0.1/browser');
  const socket = sockets[0];
  await Promise.resolve();
  socket.message({ method: 'Target.targetCreated', params: {} });
  const prematurelyClosed = socket.clientClosed;
  socket.message({ id: socket.request.id, result: {} });
  socket.onclose();
  await closing;
  assert.equal(prematurelyClosed, undefined);
});

it('reports CDP shutdown errors instead of claiming the browser closed', async (context) => {
  const sockets = websocket(context);
  const closing = closeRemoteBrowser('ws://127.0.0.1/browser');
  await Promise.resolve();
  sockets[0].message({ id: 1, error: { message: 'shutdown refused' } });
  await assert.rejects(closing, /shutdown refused/);
});

it('accepts Chrome disconnecting abruptly after its shutdown acknowledgement', async (context) => {
  const sockets = websocket(context);
  const closing = closeRemoteBrowser('ws://127.0.0.1/browser');
  await Promise.resolve();
  sockets[0].message({ id: 1, result: {} });
  sockets[0].onerror();
  sockets[0].onclose();
  await closing;
});
