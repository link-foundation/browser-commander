import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_STAGING_POLL_INTERVAL,
  DEFAULT_STAGING_STABILITY,
  DEFAULT_STAGING_TIMEOUT,
  describeStagingTimeout,
  STAGING_IN_PROGRESS_SUFFIXES,
  waitForStagedFile,
} from '../../../src/downloads/staging.js';
import { useTempDownloadDirectory } from '../../helpers/download-fixtures.js';

describe('waiting for staged bytes (issue #92)', () => {
  const directory = useTempDownloadDirectory();

  it('should report a file that is already complete', async () => {
    const staged = path.join(directory.path, 'guid-ready');
    await fs.writeFile(staged, 'complete body');

    const settled = await waitForStagedFile({ path: staged, timeout: 1000 });

    assert.strictEqual(settled.ready, true);
    assert.strictEqual(settled.bytes, 'complete body'.length);
    assert.strictEqual(settled.reason, null);
  });

  it('should wait for a file that appears after the completion event', async () => {
    // This is issue #92 exactly: the browser says "completed" and the rename
    // Chromium does behind it has not become visible yet.
    const staged = path.join(directory.path, 'guid-late');
    const appear = setTimeout(() => {
      fs.writeFile(staged, 'late body').catch(() => {});
    }, 60);

    const settled = await waitForStagedFile({
      path: staged,
      timeout: 5000,
      interval: 5,
    });
    clearTimeout(appear);

    assert.strictEqual(settled.ready, true, settled.reason ?? '');
    assert.strictEqual(settled.bytes, 'late body'.length);
  });

  it('should keep waiting while the file is still growing', async () => {
    const staged = path.join(directory.path, 'guid-growing');
    await fs.writeFile(staged, 'a');
    const grow = setInterval(() => {
      fs.appendFile(staged, 'a').catch(() => {});
    }, 5);
    setTimeout(() => clearInterval(grow), 80);

    const settled = await waitForStagedFile({
      path: staged,
      timeout: 5000,
      interval: 5,
    });
    clearInterval(grow);

    assert.strictEqual(settled.ready, true, settled.reason ?? '');
    // The quiet period ends the wait, so the file had stopped growing before
    // it was declared ready.
    assert.strictEqual(settled.bytes, (await fs.stat(staged)).size);
  });

  it('should survive a pause between writes that is longer than one poll', async () => {
    const staged = path.join(directory.path, 'guid-paused');
    await fs.writeFile(staged, 'first');
    const resume = setTimeout(() => {
      fs.appendFile(staged, '-second').catch(() => {});
    }, 25);

    const settled = await waitForStagedFile({
      path: staged,
      timeout: 1000,
      interval: 5,
      stability: 60,
    });
    clearTimeout(resume);

    assert.strictEqual(settled.ready, true, settled.reason ?? '');
    assert.strictEqual(settled.bytes, 'first-second'.length);
    assert.ok(settled.waitedMs >= 60);
  });

  it('should not claim a file whose partial sibling is still being written', async () => {
    const staged = path.join(directory.path, 'guid-partial');
    await fs.writeFile(staged, 'looks done');
    await fs.writeFile(`${staged}.crdownload`, 'still writing');

    const settled = await waitForStagedFile({
      path: staged,
      timeout: 60,
      interval: 5,
    });

    assert.strictEqual(settled.ready, false);
    assert.match(settled.reason, /\.crdownload file is still being written/);
  });

  it('should fail explicitly when the bytes never arrive', async () => {
    const staged = path.join(directory.path, 'guid-missing');

    const settled = await waitForStagedFile({
      path: staged,
      timeout: 60,
      interval: 5,
    });

    assert.strictEqual(settled.ready, false);
    assert.strictEqual(settled.bytes, null);
    assert.match(settled.reason, /has not appeared/);
  });

  it('should name the file, the budget and what it last saw', () => {
    const message = describeStagingTimeout({
      path: '/tmp/root/.browser-commander-staging/guid',
      timeout: 250,
      reason: 'the file has not appeared yet',
    });

    assert.match(message, /reported the download as completed/);
    assert.match(message, /guid/);
    assert.match(message, /250ms/);
    assert.match(message, /has not appeared yet/);
  });

  it('should ship defaults a download can actually finish within', () => {
    assert.ok(DEFAULT_STAGING_TIMEOUT >= 1000);
    assert.ok(DEFAULT_STAGING_POLL_INTERVAL > 0);
    assert.ok(DEFAULT_STAGING_STABILITY > DEFAULT_STAGING_POLL_INTERVAL);
    assert.ok(DEFAULT_STAGING_POLL_INTERVAL < DEFAULT_STAGING_TIMEOUT);
    assert.ok(STAGING_IN_PROGRESS_SUFFIXES.includes('.crdownload'));
  });
});
