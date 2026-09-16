import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';

import {
  extensionFromContent,
  isInsideRoot,
  renamedCandidate,
  resolveInsideRoot,
  sanitizeDownloadName,
  withExtension,
} from '../../../src/downloads/naming.js';

describe('download naming (issue #88)', () => {
  describe('sanitizeDownloadName', () => {
    it('should keep an ordinary name unchanged', () => {
      assert.strictEqual(
        sanitizeDownloadName('quarterly report.pdf'),
        'quarterly report.pdf'
      );
    });

    it('should refuse to let a page choose a directory', () => {
      // A suggested filename is page-controlled input. `../../etc/passwd` is a
      // request to write outside the download root, not a name.
      assert.strictEqual(sanitizeDownloadName('../../etc/passwd'), 'passwd');
      assert.strictEqual(
        sanitizeDownloadName('C:\\Windows\\system32\\evil.exe'),
        'evil.exe'
      );
      assert.strictEqual(sanitizeDownloadName('/etc/shadow'), 'shadow');
    });

    it('should strip control characters a name should never contain', () => {
      assert.strictEqual(
        sanitizeDownloadName('re\u0000port\u001f.pdf'),
        'report.pdf'
      );
    });

    it('should fall back when the page suggests nothing usable', () => {
      assert.strictEqual(sanitizeDownloadName(''), 'download');
      assert.strictEqual(sanitizeDownloadName('..'), 'download');
      assert.strictEqual(sanitizeDownloadName('   '), 'download');
      assert.strictEqual(sanitizeDownloadName(undefined), 'download');
    });

    it('should defuse reserved device names', () => {
      // `con.txt` is unopenable on Windows, and a library that produces a file
      // nobody can open has not really downloaded anything.
      assert.strictEqual(sanitizeDownloadName('con.txt'), '_con.txt');
      assert.strictEqual(sanitizeDownloadName('LPT1'), '_LPT1');
    });
  });

  describe('withExtension', () => {
    it('should leave a name that already has an extension alone', () => {
      assert.strictEqual(
        withExtension({ name: 'report.pdf', mimeType: 'text/csv' }),
        'report.pdf'
      );
    });

    it('should name a UUID-like download from its declared type', () => {
      assert.strictEqual(
        withExtension({
          name: '3f2b7c1e-0a41-4f2a-9a55-7b1c2d3e4f50',
          mimeType: 'application/pdf; charset=binary',
        }),
        '3f2b7c1e-0a41-4f2a-9a55-7b1c2d3e4f50.pdf'
      );
    });

    it('should fall back to the bytes when the server declared nothing', () => {
      assert.strictEqual(
        withExtension({
          name: 'mystery',
          head: Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]),
        }),
        'mystery.pdf'
      );
    });

    it('should trust the bytes over a generic binary type', () => {
      // `application/octet-stream` is what a server sends when it cannot name
      // the format either, so it must not win over a PDF signature and leave
      // the caller with a `.bin` file it cannot open.
      assert.strictEqual(
        withExtension({
          name: '3f2b7c1e-0a41-4f2a-9a55-7b1c2d3e4f50',
          mimeType: 'application/octet-stream',
          head: Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]),
        }),
        '3f2b7c1e-0a41-4f2a-9a55-7b1c2d3e4f50.pdf'
      );
    });

    it('should still name a truly unidentifiable binary download', () => {
      assert.strictEqual(
        withExtension({
          name: 'payload',
          mimeType: 'application/octet-stream',
          head: Buffer.from([0x01, 0x02]),
        }),
        'payload.bin'
      );
    });

    it('should leave the name alone when nothing identifies the format', () => {
      assert.strictEqual(
        withExtension({ name: 'mystery', head: Buffer.from([0x01, 0x02]) }),
        'mystery'
      );
    });
  });

  describe('extensionFromContent', () => {
    it('should identify formats by their leading bytes', () => {
      assert.strictEqual(
        extensionFromContent(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
        '.png'
      );
      assert.strictEqual(
        extensionFromContent(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
        '.zip'
      );
      assert.strictEqual(extensionFromContent(Buffer.alloc(0)), '');
      assert.strictEqual(extensionFromContent(undefined), '');
    });
  });

  describe('root containment', () => {
    const root = path.resolve('/tmp/downloads');

    it('should accept a file inside the root', () => {
      assert.strictEqual(isInsideRoot(root, `${root}/report.pdf`), true);
    });

    it('should reject the root itself and anything outside it', () => {
      assert.strictEqual(isInsideRoot(root, root), false);
      assert.strictEqual(isInsideRoot(root, '/tmp/report.pdf'), false);
      assert.strictEqual(isInsideRoot(root, `${root}/../report.pdf`), false);
    });

    it('should refuse to resolve a path that escapes the root', () => {
      assert.throws(
        () => resolveInsideRoot(root, '../escaped.pdf'),
        /outside the download directory/
      );
    });
  });

  describe('renamedCandidate', () => {
    it('should number collisions deterministically', () => {
      assert.strictEqual(renamedCandidate('report.pdf', 0), 'report.pdf');
      assert.strictEqual(renamedCandidate('report.pdf', 1), 'report (2).pdf');
      assert.strictEqual(renamedCandidate('report.pdf', 2), 'report (3).pdf');
      assert.strictEqual(renamedCandidate('archive', 1), 'archive (2)');
    });
  });
});
