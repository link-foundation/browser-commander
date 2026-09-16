import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ARTIFACT_DIRECTORY_MODE,
  prepareDownloadDirectory,
  resolveDownloadDirectory,
} from '../../../src/downloads/destination.js';
import { useTempDownloadDirectory } from '../../helpers/download-fixtures.js';

describe('download destination (issue #88)', () => {
  const directory = useTempDownloadDirectory();

  describe('resolveDownloadDirectory', () => {
    it('should resolve the temporary preset under the system temp directory', async () => {
      const resolved = await resolveDownloadDirectory('temporary');

      assert.strictEqual(
        resolved,
        path.join(os.tmpdir(), 'browser-commander-downloads')
      );
    });

    it('should resolve the user preset to an absolute path', async () => {
      const resolved = await resolveDownloadDirectory('user-downloads');

      assert.ok(path.isAbsolute(resolved));
    });

    it('should default to the user preset', async () => {
      assert.strictEqual(
        await resolveDownloadDirectory(),
        await resolveDownloadDirectory('user-downloads')
      );
    });

    it('should accept an absolute custom path', async () => {
      assert.strictEqual(
        await resolveDownloadDirectory(directory.path),
        directory.path
      );
    });

    it('should refuse a relative path rather than guess a base for it', async () => {
      await assert.rejects(
        resolveDownloadDirectory('./downloads'),
        /must be absolute/
      );
    });

    it('should refuse a setting that is neither a path nor a preset', async () => {
      await assert.rejects(resolveDownloadDirectory(42), TypeError);
      await assert.rejects(resolveDownloadDirectory(''), TypeError);
    });
  });

  describe('prepareDownloadDirectory', () => {
    it('should create the directory owner-only before any download runs', async () => {
      const nested = path.join(directory.path, 'deep', 'downloads');

      assert.strictEqual(await prepareDownloadDirectory(nested), nested);

      const stat = await fs.stat(nested);
      assert.ok(stat.isDirectory());
      assert.strictEqual(stat.mode & 0o777, ARTIFACT_DIRECTORY_MODE);
    });

    it('should leave no probe file behind', async () => {
      await prepareDownloadDirectory(directory.path);

      assert.deepStrictEqual(await fs.readdir(directory.path), []);
    });

    it(
      'should report an unwritable directory before the first download',
      {
        // Root may write into any directory, so the mode bits prove nothing there.
        skip: process.getuid?.() === 0 && 'running as root',
      },
      async () => {
        // Issue #88: the failure has to surface at configuration time, because a
        // permission error discovered after a click looks like a missing file.
        const readOnly = path.join(directory.path, 'read-only');
        await fs.mkdir(readOnly);
        await fs.chmod(readOnly, 0o500);

        await assert.rejects(
          prepareDownloadDirectory(readOnly),
          /is not writable/
        );

        await fs.chmod(readOnly, 0o700);
      }
    );

    it('should report a directory it cannot create', async () => {
      const blocker = path.join(directory.path, 'blocker');
      await fs.writeFile(blocker, 'not a directory');

      await assert.rejects(
        prepareDownloadDirectory(path.join(blocker, 'downloads')),
        /could not be created/
      );
    });
  });
});
