/**
 * A tiny server for the real-browser trace tests (issue #87).
 *
 * The trace format claims to capture things a mock cannot produce: the value a
 * user actually typed, DOM mutations an SPA makes without navigating, a full
 * navigation that replaces the document and the observer with it, a dialog, a
 * request that never reaches a server, and a download that lands on disk.
 */

import { sendHtml, sendNotFound, startFixtureHost } from './fixture-server.js';

/** Text the download endpoint serves. */
export const TRACE_DOWNLOAD_BODY = 'traced report body';

/** A password the page is given, which must never reach a bundle. */
export const TRACE_SECRET = 'correct-horse-battery-staple';

/** The page the trace tests drive. */
export const TRACE_PAGE = `<!doctype html>
<html><head><title>Traced app</title></head>
<body style="margin:0">
  <form id="signup">
    <input id="name" name="name" type="text" value="">
    <input id="password" name="password" type="password" value="">
    <select id="plan"><option value="free">Free</option><option value="pro">Pro</option></select>
    <label><input id="terms" type="checkbox"> I agree</label>
  </form>
  <ul id="items"></ul>
  <p id="status" data-state="idle">idle</p>
  <iframe id="inner" name="inner" src="/frame" style="width:80px;height:40px"></iframe>
  <a id="next" href="/next">Go to the next page</a>
  <a id="download" href="/file/report.txt" download>Download the report</a>
  <button id="add" type="button">Add an item</button>
  <button id="touch" type="button">Change the status</button>
  <button id="log" type="button">Log something</button>
  <button id="boom" type="button">Throw</button>
  <button id="ask" type="button">Ask</button>
  <button id="unreachable" type="button">Call a server that is not there</button>
  <script>
    let added = 0;
    document.getElementById('add').addEventListener('click', () => {
      const item = document.createElement('li');
      item.id = 'item-' + ++added;
      item.textContent = 'item ' + added;
      document.getElementById('items').appendChild(item);
    });
    document.getElementById('touch').addEventListener('click', () => {
      const status = document.getElementById('status');
      status.setAttribute('data-state', 'touched');
      status.textContent = 'touched';
    });
    document.getElementById('log').addEventListener('click', () => {
      console.log('something happened');
    });
    document.getElementById('boom').addEventListener('click', () => {
      setTimeout(() => {
        throw new Error('page error on purpose');
      }, 0);
    });
    document.getElementById('ask').addEventListener('click', () => {
      window.alert('are you sure?');
    });
    document.getElementById('unreachable').addEventListener('click', () => {
      // Port 1 is never listening, so the request fails in the network stack
      // rather than arriving somewhere and being answered with an error.
      fetch('http://127.0.0.1:1/nope').catch(() => {});
    });
  </script>
</body></html>`;

/** The page a full navigation lands on. */
export const NEXT_PAGE = `<!doctype html>
<html><head><title>Next page</title></head>
<body style="margin:0">
  <p id="second">the second document</p>
  <button id="grow" type="button">Grow</button>
  <ul id="more"></ul>
  <script>
    document.getElementById('grow').addEventListener('click', () => {
      const item = document.createElement('li');
      item.id = 'grown';
      item.textContent = 'grown after navigating';
      document.getElementById('more').appendChild(item);
    });
  </script>
</body></html>`;

/**
 * Start the fixture server the trace tests drive.
 *
 * @returns {Promise<{baseUrl: string, close: Function}>} Server handle
 */
export async function startTraceServer() {
  return startFixtureHost((path, req, res) => {
    if (path === '/' || path === '/app') {
      sendHtml(res, TRACE_PAGE);
      return;
    }
    if (path === '/next') {
      sendHtml(res, NEXT_PAGE);
      return;
    }
    if (path === '/frame') {
      sendHtml(res, '<!doctype html><p id="framed">inside a frame</p>');
      return;
    }
    if (path.startsWith('/file/')) {
      res.writeHead(200, {
        'content-type': 'text/plain',
        'content-disposition': `attachment; filename="${path.slice('/file/'.length)}"`,
      });
      res.end(TRACE_DOWNLOAD_BODY);
      return;
    }
    sendNotFound(res);
  });
}
