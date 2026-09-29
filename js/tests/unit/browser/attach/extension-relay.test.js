import assert from 'node:assert';
import { once } from 'node:events';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  attachViaExtension,
  checkRelayUpgrade,
  EXTENSION_DIRECTORY,
  extensionIdFromOrigin,
  RELAY_PATH,
} from '../../../../src/browser/attach/extension-relay.js';
import { connectWebSocket } from '../../../../src/browser/attach/websocket.js';
import { createRelayClient } from '../../../../extension/relay-handler.js';
import {
  createExtensionWebSocket,
  createFakeChrome,
} from '../../../helpers/fake-chrome.js';

const TABS = [
  { id: 1, url: 'https://mail.test/', title: 'Inbox', active: true },
  { id: 2, url: 'https://docs.test/', title: 'Docs', active: false },
];

/**
 * A fake extension that speaks the protocol by hand, so the test controls
 * every message.
 */
async function connectFakeExtension(url, origin = 'chrome-extension://abc') {
  const connection = await connectWebSocket(url, {
    headers: { Origin: origin },
  });
  const requests = [];
  connection.on('message', (text) => {
    const request = JSON.parse(text);
    requests.push(request);
    connection.emit('request', request);
  });
  const post = (message) => connection.send(JSON.stringify(message));
  return { connection, requests, post };
}

/** Start the relay on a free port with a hand-driven extension. */
async function attachWithFakeExtension(options = {}) {
  let extension;
  const relay = await attachViaExtension({
    port: 0,
    timeoutMs: 5_000,
    ...options,
    onListening: async ({ url }) => {
      extension = await connectFakeExtension(url);
      extension.post({
        type: 'hello',
        extensionVersion: '1.2.3',
        userAgent: 'Mozilla/5.0 Test',
      });
    },
  });
  return { relay, extension };
}

/** Answer the next request with `reply(request)`. */
function answerNext(extension, reply) {
  extension.connection.once('request', (request) =>
    extension.post({ id: request.id, ...reply(request) })
  );
}

async function statusOf(url, headers) {
  try {
    const connection = await connectWebSocket(url, { headers });
    connection.terminate();
    return 101;
  } catch (error) {
    return error.statusCode;
  }
}

describe('checkRelayUpgrade', () => {
  it('accepts one extension origin on the relay path only', () => {
    const accept = { path: RELAY_PATH, origin: 'chrome-extension://abc' };
    assert.deepEqual(checkRelayUpgrade(accept), {
      accept: true,
      extensionId: 'abc',
    });
    assert.equal(
      checkRelayUpgrade({ ...accept, path: `${RELAY_PATH}?x=1` }).accept,
      true
    );
    const status = (request) => checkRelayUpgrade(request).status;
    assert.equal(status({ ...accept, path: '/' }), 404);
    assert.equal(status({ ...accept, origin: 'http://evil.example' }), 403);
    assert.equal(status({ ...accept, origin: undefined }), 403);
    assert.equal(status({ ...accept, origin: 'null' }), 403);
    assert.equal(
      status({ ...accept, origin: 'chrome-extension://abc.evil.example' }),
      403
    );
    assert.equal(status({ ...accept, allowedExtensionIds: ['xyz'] }), 403);
    assert.equal(status({ ...accept, connected: true }), 409);
    assert.equal(extensionIdFromOrigin('chrome-extension://abc'), 'abc');
    assert.equal(extensionIdFromOrigin('moz-extension://abc'), null);
  });

  it('points at the unpacked extension', async () => {
    await access(path.join(EXTENSION_DIRECTORY, 'manifest.json'));
    await access(path.join(EXTENSION_DIRECTORY, 'background.js'));
  });
});

describe('attachViaExtension', () => {
  it('lists tabs, drives a debugger session and forwards its events', async () => {
    const { relay, extension } = await attachWithFakeExtension();
    try {
      assert.equal(relay.mode, 'extension');
      assert.deepEqual(relay.extension, {
        id: 'abc',
        version: '1.2.3',
        userAgent: 'Mozilla/5.0 Test',
      });
      assert.equal(relay.connected(), true);
      assert.ok(
        relay.differences.some(({ aspect }) => aspect === 'debugger-infobar')
      );

      answerNext(extension, () => ({ result: [{ tabId: 1, url: 'u' }] }));
      assert.deepEqual(await relay.tabs(), [{ tabId: 1, url: 'u' }]);

      answerNext(extension, () => ({ result: { attached: true } }));
      const session = await relay.session(1);
      // Attaching again is idempotent and hands back the same session.
      answerNext(extension, () => ({ result: { attached: true } }));
      assert.equal(await relay.session(1), session);

      answerNext(extension, ({ params }) => ({
        result: { echoed: params },
      }));
      assert.deepEqual(
        await session.send('Runtime.evaluate', { expression: '1+1' }),
        {
          echoed: {
            tabId: 1,
            method: 'Runtime.evaluate',
            params: { expression: '1+1' },
          },
        }
      );

      answerNext(extension, () => ({ error: { message: 'no such method' } }));
      await assert.rejects(session.send('Bad.method'), /no such method/u);

      const event = once(session, 'Page.loadEventFired');
      extension.post({
        type: 'event',
        tabId: 1,
        method: 'Page.loadEventFired',
        params: { timestamp: 7 },
      });
      assert.deepEqual(await event, [{ timestamp: 7 }]);

      const detached = new Promise((resolve) =>
        session.once('detached', resolve)
      );
      extension.post({
        type: 'detached',
        tabId: 1,
        reason: 'canceled_by_user',
      });
      assert.deepEqual(await detached, {
        tabId: 1,
        reason: 'canceled_by_user',
      });
      await assert.rejects(session.send('Page.reload'), /detached/u);

      assert.deepEqual(
        extension.requests.map(({ method }) => method),
        [
          'tabs.list',
          'debugger.attach',
          'debugger.attach',
          'cdp.send',
          'cdp.send',
        ]
      );
    } finally {
      await relay.close();
    }
  });

  it('refuses web origins with 403 and a second extension with 409', async () => {
    const { relay } = await attachWithFakeExtension();
    try {
      const url = `ws://127.0.0.1:${relay.port}${RELAY_PATH}`;
      assert.equal(await statusOf(url, { Origin: 'http://evil.example' }), 403);
      assert.equal(await statusOf(url, {}), 403);
      assert.equal(
        await statusOf(url, { Origin: 'chrome-extension://other' }),
        409
      );
      assert.equal(
        await statusOf(`ws://127.0.0.1:${relay.port}/`, {
          Origin: 'chrome-extension://abc',
        }),
        404
      );
      assert.equal(relay.connected(), true);
    } finally {
      await relay.close();
    }
    await assert.rejects(
      connectWebSocket(relay.url, {
        headers: { Origin: 'chrome-extension://abc' },
      }),
      { code: 'ECONNREFUSED' }
    );
  });

  it('rejects pending requests and detaches sessions when the extension leaves', async () => {
    const { relay, extension } = await attachWithFakeExtension();
    try {
      answerNext(extension, () => ({ result: { attached: true } }));
      const session = await relay.session(2);
      const detached = new Promise((resolve) =>
        session.once('detached', resolve)
      );
      const pending = relay.tabs();
      extension.connection.terminate();

      await assert.rejects(pending, /disconnected/u);
      assert.equal((await detached).tabId, 2);
      assert.equal(relay.connected(), false);
      await assert.rejects(relay.tabs(), /not connected/u);
    } finally {
      await relay.close();
    }
  });

  it('closes the extension connection with 1001 on close()', async () => {
    const { relay, extension } = await attachWithFakeExtension();
    const closed = once(extension.connection, 'close');
    await relay.close();
    await relay.close();
    assert.equal((await closed)[0].code, 1001);
  });

  it('accepts only allowedExtensionIds', async () => {
    let refused;
    await assert.rejects(
      attachViaExtension({
        port: 0,
        timeoutMs: 300,
        allowedExtensionIds: ['xyz'],
        onListening: ({ url }) => {
          refused = statusOf(url, { Origin: 'chrome-extension://abc' });
        },
      }),
      /Load unpacked/u
    );
    assert.equal(await refused, 403);
  });

  it('times out with install instructions and frees the port', async () => {
    let url;
    await assert.rejects(
      attachViaExtension({
        port: 0,
        timeoutMs: 100,
        onListening: (listening) => {
          url = listening.url;
        },
      }),
      (error) =>
        error.message.includes(EXTENSION_DIRECTORY) &&
        error.message.includes('Load unpacked')
    );
    await assert.rejects(
      connectWebSocket(url, { headers: { Origin: 'chrome-extension://abc' } }),
      { code: 'ECONNREFUSED' }
    );
  });

  it('listens on loopback only and validates its options', async () => {
    for (const options of [
      { host: '0.0.0.0' },
      { host: '192.168.1.2' },
      { port: 70_000 },
      { timeoutMs: 0 },
      { allowedExtensionIds: 'abc' },
    ]) {
      await assert.rejects(attachViaExtension(options), TypeError);
    }
  });

  it('drives the real extension service worker code end to end', async () => {
    const chrome = createFakeChrome({ tabs: TABS.map((tab) => ({ ...tab })) });
    let client;
    const relay = await attachViaExtension({
      port: 0,
      timeoutMs: 5_000,
      onListening: ({ port }) => {
        chrome.storage.local.get = async () => ({ port });
        client = createRelayClient({
          chrome,
          WebSocket: createExtensionWebSocket(),
          userAgent: 'Mozilla/5.0 Extension',
        });
        client.start();
      },
    });
    try {
      assert.deepEqual(relay.extension, {
        id: 'abc',
        version: '1.2.3',
        userAgent: 'Mozilla/5.0 Extension',
      });
      assert.deepEqual(await relay.tabs(), [
        { tabId: 1, url: 'https://mail.test/', title: 'Inbox', active: true },
        { tabId: 2, url: 'https://docs.test/', title: 'Docs', active: false },
      ]);
      assert.deepEqual(await relay.newTab('https://new.test/'), {
        tabId: 100,
      });

      const session = await relay.session(1);
      assert.deepEqual(
        await session.send('Runtime.evaluate', { expression: '1+1' }),
        { result: { type: 'number', value: 2 } }
      );
      await assert.rejects(session.send('Bad.method'), /wasn't found/u);

      const event = once(session, 'Network.requestWillBeSent');
      chrome.debugger.onEvent.fire({ tabId: 2 }, 'Ignored.event', {});
      chrome.debugger.onEvent.fire({ tabId: 1 }, 'Network.requestWillBeSent', {
        requestId: 'r1',
      });
      assert.deepEqual(await event, [{ requestId: 'r1' }]);

      await session.detach();
      assert.deepEqual(
        chrome.calls.filter(([name]) => name.startsWith('debugger.')),
        [
          ['debugger.attach', 1, '1.3'],
          [
            'debugger.sendCommand',
            1,
            'Runtime.evaluate',
            { expression: '1+1' },
          ],
          ['debugger.sendCommand', 1, 'Bad.method', {}],
          ['debugger.detach', 1],
        ]
      );
    } finally {
      client?.stop();
      await relay.close();
    }
  });
});
