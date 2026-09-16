/**
 * A tiny server for the real-browser download tests (issue #88).
 *
 * The issue's acceptance criteria are about downloads a mock cannot produce:
 * a link the browser downloads instead of navigating to, a file built in the
 * page from a blob, a navigation that turns into a download, a name the page
 * only hints at, and a transfer the server aborts halfway.
 */

import { sendHtml, sendNotFound, startFixtureHost } from './fixture-server.js';

/** Bytes every fixture download is expected to produce. */
export const REPORT_BODY = 'quarterly report body';

/** A body only its leading bytes identify as a PDF. */
export const PDF_BODY = `%PDF-1.7\n${REPORT_BODY}`;

/** A page offering the download shapes the issue lists. */
export const DOWNLOADS_PAGE = `<!doctype html>
<html><body style="margin:0">
  <a id="link" href="/file/report.pdf" download>Download the report</a>
  <a id="navigating" href="/attachment">Open the statement</a>
  <a id="unnamed" href="/unnamed" download>Download without a name</a>
  <a id="broken" href="/aborted" download>Download a broken file</a>
  <button id="blob">Build and download</button>
  <script>
    document.getElementById('blob').addEventListener('click', () => {
      const blob = new Blob([${JSON.stringify(REPORT_BODY)}], {
        type: 'text/plain',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'generated.txt';
      document.body.appendChild(anchor);
      anchor.click();
    });
  </script>
</body></html>`;

/**
 * Answer a request for one of the fixture downloads.
 *
 * @param {string} path - Request path
 * @param {Object} res - Node response
 * @returns {boolean} Whether the request was a download
 */
function serveDownload(path, res) {
  if (path.startsWith('/file/')) {
    res.writeHead(200, {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${path.slice('/file/'.length)}"`,
    });
    res.end(REPORT_BODY);
    return true;
  }

  if (path === '/attachment') {
    // No `download` attribute on the link: the browser starts navigating and
    // turns the navigation into a download once it reads this header.
    res.writeHead(200, {
      'content-type': 'application/pdf',
      'content-disposition': 'attachment; filename="statement.pdf"',
    });
    res.end(REPORT_BODY);
    return true;
  }

  if (path === '/unnamed') {
    // Nothing names this file and the server declares nothing useful: only the
    // bytes themselves can give it a suffix.
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    res.end(PDF_BODY);
    return true;
  }

  if (path === '/aborted') {
    res.writeHead(200, {
      'content-type': 'application/pdf',
      'content-length': '1000000',
      'content-disposition': 'attachment; filename="broken.pdf"',
    });
    res.write('partial');
    res.destroy();
    return true;
  }

  return false;
}

/**
 * Start the download fixture server on an ephemeral port.
 *
 * @returns {Promise<{baseUrl: string, close: Function}>} Server handle
 */
export async function startDownloadServer() {
  return startFixtureHost((path, req, res) => {
    if (serveDownload(path, res)) {
      return;
    }

    if (path === '/') {
      sendHtml(res, DOWNLOADS_PAGE);
      return;
    }

    sendNotFound(res);
  });
}
