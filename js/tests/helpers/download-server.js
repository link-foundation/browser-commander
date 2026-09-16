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

/**
 * A PDF large enough that Chromium writes it in more than one chunk.
 *
 * Issue #92 is a race between `Browser.downloadProgress` reporting
 * `completed` and the staged bytes being readable, so a body the browser can
 * write in a single instant is the one body that would not exercise it.
 */
export const BLOB_PDF_BODY = `%PDF-1.7\n${'blob pdf payload line\n'.repeat(40000)}%%EOF\n`;

/** A page offering the download shapes the issue lists. */
export const DOWNLOADS_PAGE = `<!doctype html>
<html><body style="margin:0">
  <a id="link" href="/file/report.pdf" download>Download the report</a>
  <a id="navigating" href="/attachment">Open the statement</a>
  <a id="unnamed" href="/unnamed" download>Download without a name</a>
  <a id="broken" href="/aborted" download>Download a broken file</a>
  <button id="blob">Build and download</button>
  <button id="blob-pdf">Build and download a PDF</button>
  <script>
    const downloadBlob = (parts, type, name) => {
      const url = URL.createObjectURL(new Blob(parts, { type }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      document.body.appendChild(anchor);
      anchor.click();
    };
    document.getElementById('blob').addEventListener('click', () => {
      downloadBlob([${JSON.stringify(REPORT_BODY)}], 'text/plain', 'generated.txt');
    });
    document.getElementById('blob-pdf').addEventListener('click', () => {
      // Built from a repeated unit rather than shipped as one literal: the
      // page has to produce the bytes, not receive them over the wire.
      const line = ${JSON.stringify('blob pdf payload line\n')};
      downloadBlob(
        ['%PDF-1.7\\n', line.repeat(40000), '%%EOF\\n'],
        'application/pdf',
        'generated.pdf'
      );
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
