/**
 * Real-browser tests for issue #88.
 *
 * The managed lifecycle only means something against a real engine: a browser
 * decides for itself when a download starts, where it stages the bytes and
 * whether a transfer failed. These tests run the same expectations against
 * both engines, because the issue asks for a manager that behaves identically
 * whichever one is driving.
 *
 * Run with: npm run test:e2e:downloads
 */

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { openBrowserCdpSession } from '../../src/downloads/sources.js';
import { launchE2EBrowser } from '../helpers/e2e-browser.js';
import {
  PDF_BODY,
  REPORT_BODY,
  startDownloadServer,
} from '../helpers/download-server.js';

const ENGINES = ['playwright', 'puppeteer'];

/**
 * Run the managed-download expectations against one engine.
 *
 * @param {string} engine - 'playwright' or 'puppeteer'
 * @returns {void}
 */
function describeDownloads(engine) {
  describe(`E2E - managed downloads with ${engine} (issue #88)`, () => {
    let server;
    let browser;
    let page;
    let downloads;
    let directory;
    let cleanup;

    before(async () => {
      server = await startDownloadServer();
      directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bc-e2e-downloads-'));
      ({ browser, page, downloads, cleanup } = await launchE2EBrowser({
        engine,
        downloadDirectory: directory,
      }));
    });

    // A download the browser decides to display instead - a PDF it can render -
    // leaves the page somewhere else, so every test starts from the fixture.
    beforeEach(async () => {
      await page.goto(`${server.baseUrl}/`);
    });

    after(async () => {
      await downloads?.dispose();
      await cleanup?.();
      await server?.close();
      await fs.rm(directory, { recursive: true, force: true });
    });

    /**
     * Click an element and wait for the download it triggers.
     *
     * @param {string} selector - Element to click
     * @param {Object} [options] - Capture options
     * @returns {Promise<Object>} The settled artifact
     */
    const captureClickOn = async (selector, options = {}) =>
      downloads.capture({
        action: () => page.click(selector),
        timeout: 20000,
        ...options,
      });

    it('should save a file the browser downloaded from a click', async () => {
      const artifact = await captureClickOn('#link');

      assert.strictEqual(artifact.state, 'completed');
      assert.strictEqual(path.basename(artifact.path), 'report.pdf');
      assert.strictEqual(await fs.readFile(artifact.path, 'utf8'), REPORT_BODY);
      assert.strictEqual(
        artifact.checksum,
        createHash('sha256').update(REPORT_BODY).digest('hex')
      );
      assert.strictEqual(artifact.bytes, Buffer.byteLength(REPORT_BODY));
    });

    it('should save a file the page built from a blob', async () => {
      const artifact = await captureClickOn('#blob');

      assert.strictEqual(path.basename(artifact.path), 'generated.txt');
      assert.strictEqual(await fs.readFile(artifact.path, 'utf8'), REPORT_BODY);
    });

    it('should save a navigation that turned into a download', async () => {
      const artifact = await captureClickOn('#navigating');

      assert.strictEqual(artifact.state, 'completed');
      assert.strictEqual(path.basename(artifact.path), 'statement.pdf');
    });

    it('should give an unnamed download an extension from its bytes', async () => {
      const artifact = await captureClickOn('#unnamed');

      assert.ok(
        artifact.path.endsWith('.pdf'),
        `expected a .pdf suffix, got ${artifact.path}`
      );
      assert.strictEqual(await fs.readFile(artifact.path, 'utf8'), PDF_BODY);
    });

    it('should let the caller name a download as it is captured', async () => {
      const artifact = await captureClickOn('#link', {
        filename: 'named-by-the-caller.pdf',
      });

      assert.strictEqual(
        path.basename(artifact.path),
        'named-by-the-caller.pdf'
      );
    });

    it('should report a transfer the server aborted, with no file left behind', async () => {
      const failures = [];
      downloads.on('failed', (artifact) => failures.push(artifact));
      downloads.on('cancelled', (artifact) => failures.push(artifact));

      // A download that never produced bytes is not a result: the awaited
      // capture fails with the engine's own words, because "a download UI
      // entry is not completion evidence" (issue #88).
      await assert.rejects(captureClickOn('#broken'), /dl-\d+/);

      assert.strictEqual(failures.length, 1);
      assert.ok(failures[0].failure, 'the engine reason should be preserved');
      const entries = await fs.readdir(directory);
      assert.ok(
        !entries.includes('broken.pdf'),
        `a failed download must not appear under its final name: ${entries}`
      );
      assert.ok(
        !entries.some((entry) => entry.endsWith('.partial')),
        `no partial file should be left behind: ${entries}`
      );
    });

    it('should manage a download the automation never started', async () => {
      // The closest a test can get to a person downloading a file: a target
      // the automation did not create, downloading through the browser rather
      // than through the engine's download API. Issue #88 asks for "one
      // lifecycle for automated *and* manual downloads".
      const session = await openBrowserCdpSession({ engine, browser, page });
      const captured = downloads.capture({ timeout: 20000 });
      await session.send('Target.createTarget', {
        url: `${server.baseUrl}/file/manual.pdf`,
      });

      const artifact = await captured;
      assert.strictEqual(path.basename(artifact.path), 'manual.pdf');
      assert.strictEqual(await fs.readFile(artifact.path, 'utf8'), REPORT_BODY);
    });

    it('should keep every saved file after the browser closes', async () => {
      const before = (await fs.readdir(directory)).sort();
      await downloads.dispose();
      await browser.close();
      browser = undefined;

      assert.deepStrictEqual((await fs.readdir(directory)).sort(), before);
      assert.ok(before.length >= 5, `expected saved files, got ${before}`);
    });
  });
}

describe(
  'E2E - managed downloads (issue #88)',
  { skip: !process.env.RUN_E2E, timeout: 180000 },
  () => {
    for (const engine of ENGINES) {
      describeDownloads(engine);
    }
  }
);
