/**
 * The bit of a fixture server that has nothing to do with the fixtures.
 *
 * The readiness pages (issue #89) and the download endpoints (issue #88) need
 * the same thing underneath: a localhost server on a port nobody else is using,
 * with a handle that shuts it down again.
 */

import { createServer } from 'node:http';

/**
 * Send an HTML fixture page.
 *
 * @param {Object} res - Node response
 * @param {string} body - Page markup
 * @returns {void}
 */
export function sendHtml(res, body) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body);
}

/**
 * Answer a request for a fixture that does not exist.
 *
 * @param {Object} res - Node response
 * @returns {void}
 */
export function sendNotFound(res) {
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
}

/**
 * Start a fixture server on an ephemeral port.
 *
 * @param {Function} handle - Request handler, called with (path, req, res)
 * @param {Function} [onClose] - Teardown to run before the server closes
 * @returns {Promise<{baseUrl: string, close: Function}>} Server handle
 */
export async function startFixtureHost(handle, onClose) {
  const server = createServer((req, res) => {
    handle(req.url.split('?')[0], req, res);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await onClose?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
