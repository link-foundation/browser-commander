import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { setImmediate as yieldToEngine } from 'node:timers/promises';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  createDownloadManager,
  DOWNLOAD_EVENT,
} from '../../../src/downloads/manager.js';
import { STAGING_DIRECTORY } from '../../../src/downloads/sources.js';
import {
  createFakeCdpSession,
  createFakeContext,
  makeFakeDownload,
  makeTempDirectory,
} from '../../helpers/download-fixtures.js';

describe('download manager (issue #88)', () => {
  let root;
  let staging;
  let context;
  let manager;

  beforeEach(async () => {
    root = await makeTempDirectory();
    staging = await makeTempDirectory();
    context = createFakeContext();
  });

  afterEach(async () => {
    await manager?.dispose();
    manager = undefined;
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(staging, { recursive: true, force: true });
  });

  /**
   * Start a manager over the fake Playwright context.
   *
   * @param {Object} [options] - Extra manager options
   * @returns {Promise<Object>} The manager
   */
  const managerOver = async (options = {}) => {
    manager = await createDownloadManager({
      engine: 'playwright',
      context,
      directory: root,
      ...options,
    });
    return manager;
  };

  /**
   * Emit a fake download through the context.
   *
   * @param {Object} [options] - Fake download options
   * @returns {Promise<Object>} The fake download
   */
  const emitDownload = async (options = {}) => {
    const download = await makeFakeDownload({
      dir: staging,
      suggestedFilename: 'report.pdf',
      ...options,
    });
    await context.emitDownload(download);
    // Engine download events are fire-and-forget; the save they start is not.
    await manager.idle();
    return download;
  };

  /**
   * Record every artifact published under one lifecycle event.
   *
   * @param {string} event - Lifecycle event to listen for
   * @returns {Object[]} Artifacts, in the order they were published
   */
  const collect = (event) => {
    const published = [];
    manager.on(event, (artifact) => published.push(artifact));
    return published;
  };

  /**
   * List the managed directory, ignoring engine staging.
   *
   * @returns {Promise<string[]>} Sorted entry names
   */
  const listing = async () =>
    (await fs.readdir(root)).filter((e) => e !== STAGING_DIRECTORY).sort();

  it('should prepare the download directory before any download arrives', async () => {
    const created = path.join(root, 'nested');

    await managerOver({ directory: created });

    assert.strictEqual(manager.directory, created);
    assert.ok((await fs.stat(created)).isDirectory());
  });

  it('should save a download and report it as completed', async () => {
    await managerOver();
    const completed = collect(DOWNLOAD_EVENT.COMPLETED);

    await emitDownload({ body: 'report body' });

    assert.strictEqual(completed.length, 1);
    assert.strictEqual(completed[0].state, DOWNLOAD_EVENT.COMPLETED);
    assert.strictEqual(path.basename(completed[0].path), 'report.pdf');
    assert.strictEqual(completed[0].bytes, 11);
    assert.match(completed[0].checksum, /^[0-9a-f]{64}$/);
    assert.ok(completed[0].id.startsWith('dl-'));
    assert.ok(completed[0].completedAt);
    assert.strictEqual(
      await fs.readFile(completed[0].path, 'utf8'),
      'report body'
    );
  });

  it('should keep the file after the browser that produced it is gone', async () => {
    await managerOver();
    await emitDownload({ body: 'persisted' });
    const [artifact] = manager.list();

    await manager.dispose();
    manager = undefined;

    assert.strictEqual(await fs.readFile(artifact.path, 'utf8'), 'persisted');
  });

  it('should report an engine failure with the engine reason preserved', async () => {
    await managerOver();
    const failed = collect(DOWNLOAD_EVENT.FAILED);

    await emitDownload({ failure: 'net::ERR_CONNECTION_RESET' });

    assert.strictEqual(failed.length, 1);
    assert.strictEqual(failed[0].failure, 'net::ERR_CONNECTION_RESET');
    assert.strictEqual(failed[0].path, null);
    assert.deepStrictEqual(await listing(), []);
  });

  it('should report a cancelled download as cancelled, not as a failure', async () => {
    await managerOver();
    const events = [];
    manager.on(DOWNLOAD_EVENT.CANCELLED, () => events.push('cancelled'));
    manager.on(DOWNLOAD_EVENT.FAILED, () => events.push('failed'));

    await emitDownload({ failure: 'canceled' });

    assert.deepStrictEqual(events, ['cancelled']);
  });

  it('should report each download once when a listener and a capture both watch', async () => {
    // Issue #88: "a download that a global listener and an awaited capture()
    // both see must be saved once and reported once".
    await managerOver();
    const completed = collect(DOWNLOAD_EVENT.COMPLETED);

    const captured = await manager.capture({
      action: () => emitDownload({ body: 'once' }),
    });

    assert.strictEqual(completed.length, 1);
    assert.strictEqual(completed[0], captured);
    assert.strictEqual(manager.list().length, 1);
    assert.deepStrictEqual(await listing(), ['report.pdf']);
  });

  it('should catch a download that starts inside the triggering action', async () => {
    // Arming after the action would lose this one: the race the issue calls out.
    await managerOver();

    const artifact = await manager.capture({
      action: () => emitDownload({ body: 'raced' }),
    });

    assert.strictEqual(artifact.state, DOWNLOAD_EVENT.COMPLETED);
  });

  it('should name a captured download without losing the safety rules', async () => {
    await managerOver();

    const artifact = await manager.capture({
      action: () =>
        emitDownload({
          suggestedFilename: '8d0f9e2c-4a11-4b22-9f00-1d2e3f405162',
          body: '%PDF-1.7 invoice',
        }),
      filename: () => '../invoice.pdf',
    });

    assert.strictEqual(artifact.path, path.join(root, 'invoice.pdf'));
  });

  it('should fail a capture whose download does not validate', async () => {
    await managerOver();

    await assert.rejects(
      manager.capture({
        action: () => emitDownload({ body: '<html>login</html>' }),
        validate: ({ bytes }) => {
          if (bytes < 1000) {
            throw new Error('expected a PDF, got a login page');
          }
        },
      }),
      /failed: expected a PDF/
    );

    assert.deepStrictEqual(await listing(), []);
  });

  it('should time out rather than wait forever for a download that never starts', async () => {
    await managerOver();

    await assert.rejects(
      manager.capture({ action: () => {}, timeout: 50 }),
      /no download completed within 50ms/
    );
  });

  it('should propagate an error from the triggering action', async () => {
    await managerOver();

    await assert.rejects(
      manager.capture({
        action: () => {
          throw new Error('the button was not there');
        },
      }),
      /the button was not there/
    );
  });

  it('should resolve a name collision without replacing the earlier file', async () => {
    await managerOver();

    await emitDownload({ body: 'first' });
    await emitDownload({ body: 'second' });

    assert.deepStrictEqual(await listing(), ['report (2).pdf', 'report.pdf']);
    assert.strictEqual(manager.list().length, 2);
  });

  it('should list every download in the order it started', async () => {
    await managerOver();

    await emitDownload({ suggestedFilename: 'a.txt' });
    await emitDownload({ suggestedFilename: 'b.txt' });

    assert.deepStrictEqual(
      manager.list().map((artifact) => artifact.suggestedFilename),
      ['a.txt', 'b.txt']
    );
  });

  describe('manual downloads over CDP', () => {
    /**
     * Start a manager whose only source is a fake CDP session.
     *
     * @param {Object} session - Fake CDP session
     * @returns {Promise<Object>} The manager
     */
    const cdpManagerOver = async (session) =>
      createDownloadManager({
        engine: 'puppeteer',
        directory: root,
        browser: {
          target: () => ({ createCDPSession: async () => session }),
        },
      });

    /**
     * Describe the CDP command that sends downloads to this test's staging path.
     *
     * @param {string} [browserContextId] - Context to configure
     * @returns {Object} Expected CDP command
     */
    const downloadBehaviorCommand = (browserContextId) => ({
      method: 'Browser.setDownloadBehavior',
      params: {
        behavior: 'allowAndName',
        downloadPath: path.join(root, STAGING_DIRECTORY),
        eventsEnabled: true,
        ...(browserContextId ? { browserContextId } : {}),
      },
    });

    it('should ask Chromium to report downloads it did not automate', async () => {
      const session = createFakeCdpSession();
      manager = await cdpManagerOver(session);

      assert.deepStrictEqual(session.sent, [downloadBehaviorCommand()]);
    });

    it('should scope download behavior to the page browser context', async () => {
      // Issue #97: browser.newPage() and browser.newContext() create a
      // non-default Chromium context. Browser download events are global, but
      // the path configured without this id belongs to the default context.
      const browserSession = createFakeCdpSession();
      browserSession.send = async (method, params) => {
        browserSession.sent.push({ method, params });
        if (method === 'Target.getBrowserContexts') {
          return { browserContextIds: ['context-from-target'] };
        }
        return undefined;
      };
      const pageSession = createFakeCdpSession();
      pageSession.send = async (method, params) => {
        pageSession.sent.push({ method, params });
        return {
          targetInfo: { browserContextId: 'context-from-target' },
        };
      };
      let pageSessionDetached = false;
      pageSession.detach = async () => {
        pageSessionDetached = true;
      };
      const browser = {
        newBrowserCDPSession: async () => browserSession,
      };
      const browserContext = {
        browser: () => browser,
        newCDPSession: async () => pageSession,
      };
      const page = { context: () => browserContext };

      manager = await createDownloadManager({
        engine: 'playwright',
        browser: browserContext,
        page,
        directory: root,
      });

      assert.deepStrictEqual(pageSession.sent, [
        { method: 'Target.getTargetInfo', params: undefined },
      ]);
      assert.strictEqual(pageSessionDetached, true);
      assert.deepStrictEqual(browserSession.sent, [
        { method: 'Target.getBrowserContexts', params: undefined },
        downloadBehaviorCommand('context-from-target'),
      ]);
    });

    it('should keep a persistent context on default download behavior', async () => {
      const session = createFakeCdpSession();
      const persistentContext = {
        browser: () => null,
        newCDPSession: async () => session,
      };

      manager = await createDownloadManager({
        engine: 'playwright',
        browser: persistentContext,
        page: { context: () => persistentContext },
        directory: root,
      });

      assert.deepStrictEqual(session.sent, [downloadBehaviorCommand()]);
    });

    it('should place a manually started download like an automated one', async () => {
      const session = createFakeCdpSession();
      manager = await cdpManagerOver(session);
      const completed = collect(DOWNLOAD_EVENT.COMPLETED);

      const guid = 'guid-0001';
      session.emit('Browser.downloadWillBegin', {
        guid,
        url: 'https://example.com/manual.pdf',
        suggestedFilename: 'manual.pdf',
      });
      await fs.writeFile(
        path.join(root, STAGING_DIRECTORY, guid),
        'manual body'
      );
      session.emit('Browser.downloadProgress', { guid, state: 'completed' });
      await manager.idle();

      assert.strictEqual(completed.length, 1);
      assert.strictEqual(completed[0].path, path.join(root, 'manual.pdf'));
      assert.strictEqual(
        await fs.readFile(completed[0].path, 'utf8'),
        'manual body'
      );
      // The staged copy is the engine's, not the user's: it does not linger.
      assert.deepStrictEqual(
        await fs.readdir(path.join(root, STAGING_DIRECTORY)),
        []
      );
    });

    it('should report a download the browser refused', async () => {
      const session = createFakeCdpSession();
      manager = await cdpManagerOver(session);
      const cancelled = collect(DOWNLOAD_EVENT.CANCELLED);

      session.emit('Browser.downloadWillBegin', {
        guid: 'guid-0002',
        url: 'https://example.com/blocked.exe',
        suggestedFilename: 'blocked.exe',
      });
      session.emit('Browser.downloadProgress', {
        guid: 'guid-0002',
        state: 'canceled',
      });
      await yieldToEngine();

      assert.strictEqual(cancelled.length, 1);
      assert.match(cancelled[0].failure, /canceled/);
    });

    it('should wait for staged bytes that land after the completion event', async () => {
      // Issue #92: Chromium writes `<guid>.crdownload` and renames it, so the
      // completion event can arrive before `<guid>` is openable. Publishing on
      // the event alone turned a download that succeeded into
      // `ENOENT ... .browser-commander-staging/<guid>`.
      const session = createFakeCdpSession();
      manager = await cdpManagerOver(session);
      const completed = collect(DOWNLOAD_EVENT.COMPLETED);
      const failed = collect(DOWNLOAD_EVENT.FAILED);

      const guid = 'guid-0010';
      const stagedPath = path.join(root, STAGING_DIRECTORY, guid);
      session.emit('Browser.downloadWillBegin', {
        guid,
        url: 'https://example.com/late.pdf',
        suggestedFilename: 'late.pdf',
      });
      // The event first, the bytes afterwards - the ordering from the report.
      session.emit('Browser.downloadProgress', { guid, state: 'completed' });
      await yieldToEngine();
      assert.deepStrictEqual(completed, [], 'published before the bytes exist');
      await fs.writeFile(stagedPath, 'late body');

      await manager.idle();

      assert.deepStrictEqual(failed, []);
      assert.strictEqual(completed.length, 1);
      assert.strictEqual(
        await fs.readFile(completed[0].path, 'utf8'),
        'late body'
      );
      assert.deepStrictEqual(
        await fs.readdir(path.join(root, STAGING_DIRECTORY)),
        []
      );
    });

    it('should not claim bytes while the partial file is still being written', async () => {
      const session = createFakeCdpSession();
      manager = await cdpManagerOver(session);
      const completed = collect(DOWNLOAD_EVENT.COMPLETED);

      const guid = 'guid-0011';
      const stagedPath = path.join(root, STAGING_DIRECTORY, guid);
      session.emit('Browser.downloadWillBegin', {
        guid,
        url: 'https://example.com/partial.pdf',
        suggestedFilename: 'partial.pdf',
      });
      // A half-written file under the final name, with Chromium's own
      // in-progress marker still beside it.
      await fs.writeFile(stagedPath, 'half');
      await fs.writeFile(`${stagedPath}.crdownload`, 'rest');
      session.emit('Browser.downloadProgress', { guid, state: 'completed' });
      await yieldToEngine();
      await yieldToEngine();
      assert.deepStrictEqual(completed, [], 'claimed a half-written file');

      await fs.rm(`${stagedPath}.crdownload`);
      await fs.writeFile(stagedPath, 'half and rest');
      await manager.idle();

      assert.strictEqual(completed.length, 1);
      assert.strictEqual(
        await fs.readFile(completed[0].path, 'utf8'),
        'half and rest'
      );
    });

    it('should report a completion whose bytes never arrive as a failure', async () => {
      const session = createFakeCdpSession();
      manager = await createDownloadManager({
        engine: 'puppeteer',
        directory: root,
        browser: {
          target: () => ({ createCDPSession: async () => session }),
        },
        stagingTimeout: 60,
        stagingPollInterval: 5,
      });
      const failed = collect(DOWNLOAD_EVENT.FAILED);
      const completed = collect(DOWNLOAD_EVENT.COMPLETED);

      session.emit('Browser.downloadWillBegin', {
        guid: 'guid-0012',
        url: 'https://example.com/ghost.pdf',
        suggestedFilename: 'ghost.pdf',
      });
      session.emit('Browser.downloadProgress', {
        guid: 'guid-0012',
        state: 'completed',
      });
      await manager.idle();

      assert.deepStrictEqual(completed, []);
      assert.strictEqual(failed.length, 1);
      assert.match(failed[0].failure, /was not readable within 60ms/);
      assert.match(failed[0].failure, /guid-0012/);
    });

    it('should keep a capture waiting until the staged bytes are readable', async () => {
      const session = createFakeCdpSession();
      manager = await cdpManagerOver(session);

      const guid = 'guid-0013';
      const stagedPath = path.join(root, STAGING_DIRECTORY, guid);
      const artifact = await manager.capture({
        timeout: 5000,
        action: async () => {
          session.emit('Browser.downloadWillBegin', {
            guid,
            url: 'https://example.com/captured.pdf',
            suggestedFilename: 'captured.pdf',
          });
          session.emit('Browser.downloadProgress', {
            guid,
            state: 'completed',
          });
          setTimeout(() => {
            fs.writeFile(stagedPath, 'captured body').catch(() => {});
          }, 40);
        },
      });

      assert.strictEqual(artifact.state, DOWNLOAD_EVENT.COMPLETED);
      assert.strictEqual(
        await fs.readFile(artifact.path, 'utf8'),
        'captured body'
      );
    });

    it('should ignore progress for a download it never saw start', async () => {
      const session = createFakeCdpSession();
      manager = await cdpManagerOver(session);

      session.emit('Browser.downloadProgress', {
        guid: 'unknown',
        state: 'completed',
      });
      await yieldToEngine();

      assert.deepStrictEqual(manager.list(), []);
    });
  });
});
