/**
 * A tiny static server for the real-browser readiness and click tests.
 *
 * The issue #89 repros need pages that a mock cannot fake: an element far
 * below the fold, a button whose handler does nothing, a link that navigates,
 * and a page whose network never goes quiet. Serving them from localhost keeps
 * the tests self-contained - no external app has to be running.
 */

import { sendHtml, sendNotFound, startFixtureHost } from './fixture-server.js';

/** A button 4200px down a tall page, matching the issue #89 repro. */
export const FAR_BELOW_FOLD_PAGE = `<!doctype html>
<html><body style="margin:0">
  <div style="height:4200px"></div>
  <button id="target" style="height:40px">Far below the fold</button>
  <div style="height:2000px"></div>
  <script>
    window.__clicks = 0;
    document.getElementById('target').addEventListener('click', () => {
      window.__clicks += 1;
      document.getElementById('target').setAttribute('aria-pressed', 'true');
    });
  </script>
</body></html>`;

/** A button in the viewport whose handler does nothing observable. */
export const NO_OP_PAGE = `<!doctype html>
<html><body style="margin:0">
  <button id="noop" style="height:40px">Does nothing</button>
  <script>
    window.__clicks = 0;
    document.getElementById('noop').addEventListener('click', () => {
      window.__clicks += 1;
    });
  </script>
</body></html>`;

/** A link that navigates to another page on the same server. */
export const NAVIGATES_PAGE = `<!doctype html>
<html><body style="margin:0">
  <a id="go" href="/arrived">Go</a>
</body></html>`;

/** The navigation target. */
export const ARRIVED_PAGE =
  '<!doctype html><html><body><h1 id="arrived">Arrived</h1></body></html>';

/** A page that keeps a request in flight forever, so the network never idles. */
export const NEVER_IDLE_PAGE = `<!doctype html>
<html><body>
  <p id="loaded">loaded</p>
  <script>fetch('/hang').catch(() => {});</script>
</body></html>`;

const PAGES = {
  '/far-below-fold': FAR_BELOW_FOLD_PAGE,
  '/no-op': NO_OP_PAGE,
  '/navigates': NAVIGATES_PAGE,
  '/arrived': ARRIVED_PAGE,
  '/never-idle': NEVER_IDLE_PAGE,
};

/**
 * Start the fixture server on an ephemeral port.
 *
 * @returns {Promise<{baseUrl: string, close: Function}>} Server handle
 */
export async function startFixtureServer() {
  /** Requests parked on purpose, closed when the server shuts down. */
  const hanging = new Set();

  return startFixtureHost(
    (path, req, res) => {
      if (path === '/hang') {
        hanging.add(res);
        res.on('close', () => hanging.delete(res));
        return;
      }

      const body = PAGES[path];
      if (body === undefined) {
        sendNotFound(res);
        return;
      }

      sendHtml(res, body);
    },
    () => {
      for (const res of hanging) {
        res.destroy();
      }
      hanging.clear();
    }
  );
}
