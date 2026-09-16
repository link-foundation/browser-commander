import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

import {
  cleanPartials,
  DOWNLOAD_CONFLICT,
  saveDownload,
} from '../../../src/downloads/store.js';
import { useTempDownloadDirectory } from '../../helpers/download-fixtures.js';

/**
 * A download source made of literal bytes.
 *
 * @param {string|Buffer} body - File contents
 * @returns {Object} Source accepted by `saveDownload`
 */
const bytes = (body) => ({ stream: Readable.from([Buffer.from(body)]) });

describe('download store (issue #88)', () => {
  const directory = useTempDownloadDirectory();

  /**
   * List the files currently in the download root.
   *
   * @returns {Promise<string[]>} Sorted entry names
   */
  const listing = async () => (await fs.readdir(directory.path)).sort();

  /**
   * Save two downloads that suggest the same name.
   *
   * @param {string} [conflict] - Conflict policy for the second one
   * @returns {Promise<Object>} What the second save reported
   */
  const saveTwice = async (conflict) => {
    await saveDownload({
      root: directory.path,
      source: bytes('first'),
      suggestedFilename: 'report.pdf',
    });
    return saveDownload({
      root: directory.path,
      source: bytes('second'),
      suggestedFilename: 'report.pdf',
      conflict,
    });
  };

  it('should save a download under its suggested name', async () => {
    const saved = await saveDownload({
      root: directory.path,
      source: bytes('report body'),
      suggestedFilename: 'report.pdf',
    });

    assert.strictEqual(saved.path, path.join(directory.path, 'report.pdf'));
    assert.strictEqual(saved.bytes, 11);
    assert.strictEqual(
      saved.checksum,
      createHash('sha256').update('report body').digest('hex')
    );
    assert.strictEqual(await fs.readFile(saved.path, 'utf8'), 'report body');
  });

  it('should write the file with owner-only permissions', async () => {
    const saved = await saveDownload({
      root: directory.path,
      source: bytes('secret'),
      suggestedFilename: 'secret.txt',
    });

    const stat = await fs.stat(saved.path);
    assert.strictEqual(stat.mode & 0o777, 0o600);
  });

  it('should number a colliding name instead of replacing the file', async () => {
    const second = await saveTwice();

    assert.strictEqual(path.basename(second.path), 'report (2).pdf');
    assert.deepStrictEqual(await listing(), ['report (2).pdf', 'report.pdf']);
    assert.strictEqual(
      await fs.readFile(path.join(directory.path, 'report.pdf'), 'utf8'),
      'first'
    );
  });

  it('should replace the file when the caller asked for overwrite', async () => {
    const second = await saveTwice(DOWNLOAD_CONFLICT.OVERWRITE);

    assert.deepStrictEqual(await listing(), ['report.pdf']);
    assert.strictEqual(await fs.readFile(second.path, 'utf8'), 'second');
  });

  it('should refuse a collision when the caller asked for error', async () => {
    await assert.rejects(
      saveTwice(DOWNLOAD_CONFLICT.ERROR),
      /refusing to replace/
    );
    assert.deepStrictEqual(await listing(), ['report.pdf']);
  });

  it('should keep a traversal attempt inside the download root', async () => {
    // A naming callback expresses a preference, not a grant of write access:
    // the path part is dropped and only the leaf name survives.
    const saved = await saveDownload({
      root: directory.path,
      source: bytes('payload'),
      suggestedFilename: 'safe.txt',
      filename: () => '../../escaped.txt',
    });

    assert.strictEqual(saved.path, path.join(directory.path, 'escaped.txt'));
    const parent = await fs.readdir(path.dirname(directory.path));
    assert.ok(!parent.includes('escaped.txt'));
  });

  it('should refuse a page-suggested name that points outside the root', async () => {
    const saved = await saveDownload({
      root: directory.path,
      source: bytes('payload'),
      suggestedFilename: '../../../etc/passwd',
    });

    assert.strictEqual(saved.path, path.join(directory.path, 'passwd'));
  });

  // Issue #88: "a half-written or invalid artifact must never appear under
  // the final name". A validator rejects either by throwing or by answering
  // `false`, and neither may leave anything behind.
  const rejections = [
    {
      title: 'validation throws',
      expected: /expected a PDF/,
      validate: ({ bytes: size }) => {
        if (size < 1000) {
          throw new Error('expected a PDF, got a login page');
        }
      },
    },
    {
      title: 'validation answers false',
      expected: /rejected by the caller/,
      validate: ({ mimeType }) => mimeType === 'application/pdf',
    },
  ];

  for (const { title, expected, validate } of rejections) {
    it(`should leave no file behind when ${title}`, async () => {
      await assert.rejects(
        saveDownload({
          root: directory.path,
          source: bytes('<html>login page</html>'),
          suggestedFilename: 'invoice.pdf',
          mimeType: 'text/html',
          validate,
        }),
        expected
      );

      assert.deepStrictEqual(await listing(), []);
    });
  }

  it('should hand validation the real bytes before publishing them', async () => {
    const seen = [];
    await saveDownload({
      root: directory.path,
      source: bytes('%PDF-1.7 body'),
      suggestedFilename: 'invoice',
      mimeType: 'application/pdf',
      validate: async (details) => {
        seen.push({
          ...details,
          head: (await fs.readFile(details.path)).subarray(0, 4).toString(),
        });
      },
    });

    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].head, '%PDF');
    assert.strictEqual(seen[0].bytes, 13);
    // Validation sees the partial file, never the published name.
    assert.ok(seen[0].path.endsWith('.partial'));
    assert.deepStrictEqual(await listing(), ['invoice.pdf']);
  });

  it('should let a caller name the file without losing the safety rules', async () => {
    const saved = await saveDownload({
      root: directory.path,
      source: bytes('payload'),
      suggestedFilename: '8d0f9e2c-4a11-4b22-9f00-1d2e3f405162',
      mimeType: 'application/pdf',
      filename: ({ suggestedFilename }) => `invoice-${suggestedFilename}`,
    });

    assert.strictEqual(
      path.basename(saved.path),
      'invoice-8d0f9e2c-4a11-4b22-9f00-1d2e3f405162.pdf'
    );
  });

  it('should clean up partial files left by an interrupted run', async () => {
    const stale = path.join(directory.path, 'report.pdf.1234.partial');
    await fs.writeFile(stale, 'half');

    const removed = await cleanPartials(directory.path);

    assert.deepStrictEqual(removed, [stale]);
    assert.deepStrictEqual(await listing(), []);
  });
});
