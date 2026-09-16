import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  attachDownloads,
  normalizeDownloadOptions,
} from '../../../src/downloads/attach.js';
import { connectBrowserWithDependencies } from '../../../src/browser/connector.js';
import { makeBrowserCommander } from '../../../src/factory.js';
import {
  createFakeContext,
  makeFakeDownload,
  useTempDownloadDirectory,
} from '../../helpers/download-fixtures.js';

/**
 * A page that belongs to the given context, as Playwright's page does.
 *
 * @param {Object} context - Fake browser context
 * @returns {Object} Minimal page object
 */
function pageOf(context) {
  return {
    context: () => context,
    // detectEngine() recognizes Playwright by locator() plus context().
    locator: () => ({}),
    on: () => {},
    off: () => {},
  };
}

/**
 * Build a commander over a fake context, with only the download wiring on.
 *
 * @param {Object} context - Fake browser context
 * @param {Object} [downloads] - A manager to expose as commander.downloads
 * @returns {Object} Browser commander
 */
function commanderOver(context, downloads) {
  return makeBrowserCommander({
    page: pageOf(context),
    enableNetworkTracking: false,
    enableNavigationManager: false,
    enableDialogManager: false,
    downloads,
  });
}

describe('download attachment (issue #88)', () => {
  const directory = useTempDownloadDirectory();

  describe('normalizeDownloadOptions', () => {
    it('should treat an absent or disabled option as no manager', () => {
      assert.strictEqual(normalizeDownloadOptions(undefined), null);
      assert.strictEqual(normalizeDownloadOptions(false), null);
      assert.strictEqual(normalizeDownloadOptions(null), null);
    });

    it('should read true as "manage downloads with the defaults"', () => {
      assert.deepStrictEqual(normalizeDownloadOptions(true), {});
    });

    it('should pass an options object through untouched', () => {
      const options = { directory: '/tmp/x', conflict: 'overwrite' };
      assert.strictEqual(normalizeDownloadOptions(options), options);
    });

    it('should refuse a value that cannot describe a directory', () => {
      assert.throws(
        () => normalizeDownloadOptions('/tmp/downloads'),
        /downloads must be true, false or an options object/
      );
    });
  });

  it('should attach nothing when the caller did not ask for downloads', () => {
    assert.strictEqual(
      attachDownloads({ engine: 'playwright', browser: createFakeContext() }),
      null
    );
  });

  it('should manage downloads from the context it was attached to', async () => {
    const context = createFakeContext();
    const manager = await attachDownloads({
      engine: 'playwright',
      browser: context,
      downloads: { directory: directory.path },
    });

    await context.emitDownload(
      await makeFakeDownload({
        dir: directory.path,
        suggestedFilename: 'a.txt',
      })
    );
    await manager.idle();

    assert.deepStrictEqual(
      manager.list().map((artifact) => path.basename(artifact.path)),
      ['a.txt']
    );
    await manager.dispose();
  });

  it('should give a connected browser the same lifecycle as a launched one', async () => {
    // Issue #88 asks for one manager "identical across launchBrowser(),
    // connectBrowser() and launchRealBrowser()", so the connector must return
    // the same handle rather than leaving attached browsers unmanaged.
    const context = createFakeContext();
    const browser = { contexts: () => [context] };
    context.pages = () => [pageOf(context)];

    const connection = await connectBrowserWithDependencies(
      {
        engine: 'playwright',
        cdpEndpoint: 'http://127.0.0.1:9222',
        downloads: { directory: directory.path },
      },
      {
        loadPlaywright: async () => ({
          chromium: { connectOverCDP: async () => browser },
        }),
      }
    );

    assert.ok(connection.downloads, 'connectBrowser should return a manager');
    assert.strictEqual(connection.downloads.directory, directory.path);

    await context.emitDownload(
      await makeFakeDownload({
        dir: directory.path,
        suggestedFilename: 'attached.txt',
      })
    );
    await connection.downloads.idle();

    assert.strictEqual(
      await fs.readFile(path.join(directory.path, 'attached.txt'), 'utf8'),
      'hello'
    );
    await connection.downloads.dispose();
  });

  it('should leave a connection unmanaged when downloads were not requested', async () => {
    const context = createFakeContext();
    context.pages = () => [pageOf(context)];

    const connection = await connectBrowserWithDependencies(
      { engine: 'playwright', cdpEndpoint: 'http://127.0.0.1:9222' },
      {
        loadPlaywright: async () => ({
          chromium: {
            connectOverCDP: async () => ({ contexts: () => [context] }),
          },
        }),
      }
    );

    assert.strictEqual(connection.downloads, null);
  });

  describe('commander.configureDownloads', () => {
    it('should expose a manager the caller already has', () => {
      const context = createFakeContext();
      const manager = { directory: directory.path };
      const commander = commanderOver(context, manager);

      assert.strictEqual(commander.downloads, manager);
    });

    it('should attach a manager to a commander built without one', async () => {
      const context = createFakeContext();
      const commander = commanderOver(context);
      assert.strictEqual(commander.downloads, null);

      const manager = await commander.configureDownloads({
        directory: directory.path,
      });

      assert.strictEqual(commander.downloads, manager);
      await context.emitDownload(
        await makeFakeDownload({
          dir: directory.path,
          suggestedFilename: 'configured.txt',
        })
      );
      await manager.idle();

      assert.strictEqual(
        path.basename(manager.list()[0].path),
        'configured.txt'
      );
      await manager.dispose();
    });

    it('should keep downloaded files when the commander is destroyed', async () => {
      // Persistence is the point: destroying the commander stops observation,
      // it does not take the user's file away.
      const context = createFakeContext();
      const commander = commanderOver(context);
      await commander.configureDownloads({ directory: directory.path });

      await context.emitDownload(
        await makeFakeDownload({
          dir: directory.path,
          suggestedFilename: 'kept.txt',
        })
      );
      await commander.destroy();

      assert.strictEqual(
        await fs.readFile(path.join(directory.path, 'kept.txt'), 'utf8'),
        'hello'
      );
    });
  });
});
