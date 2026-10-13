/**
 * A fake DevTools HTTP endpoint for hand-off tests (issue #174): it answers
 * `/json/version` with a browser WebSocket URL and accepts `Browser.close`
 * on that WebSocket, so detach/reconnect/close run without a browser.
 */
import http from 'node:http';
import { acceptUpgrade } from '../../src/browser/attach/websocket.js';

/**
 * @param {Object} [options]
 * @param {string} [options.browserId='browser-1'] - Identity in webSocketDebuggerUrl
 * @param {Function} [options.onBrowserClose] - Called when Browser.close arrives
 * @returns {Promise<Object>} `{ endpoint, webSocketDebuggerUrl, closes, setBrowserId, close }`
 */
export async function startFakeCdpEndpoint({
  browserId = 'browser-1',
  onBrowserClose = () => {},
} = {}) {
  const closes = [];
  let currentId = browserId;
  const server = http.createServer((request, response) => {
    if (request.url !== '/json/version') {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        Browser: 'FakeChrome/1.0',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/${currentId}`,
      })
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  server.on('upgrade', (request, socket, head) => {
    const connection = acceptUpgrade(request, socket, head);
    connection?.on('message', (text) => {
      const message = JSON.parse(text);
      if (message.method === 'Browser.close') {
        closes.push(request.url);
        connection.send(JSON.stringify({ id: message.id, result: {} }));
        onBrowserClose();
        socket.end();
      }
    });
  });
  return {
    endpoint: `http://127.0.0.1:${port}`,
    get webSocketDebuggerUrl() {
      return `ws://127.0.0.1:${port}/devtools/browser/${currentId}`;
    },
    closes,
    /** Pretend another browser now listens on the same port. */
    setBrowserId: (id) => {
      currentId = id;
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
