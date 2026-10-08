import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathExists } from './fs-utils.js';

import {
  openSqliteDatabase,
  backupSqliteDatabase,
} from '../browser-cookie-database.js';

/**
 * Read a Chromium SQLite database (History, Top Sites, Login Data, Web Data)
 * while the source browser is running, without ever writing to the source.
 *
 * SQLite online backup includes committed WAL data without writing to the
 * source. If a sharing/exclusive lock prevents backup, callers receive guidance
 * to close the browser or supply a consistent snapshot. A sequential copy of a
 * live database and its sidecars cannot guarantee consistency.
 */

/**
 * Produce a consistent, read-only snapshot copy of a live Chromium database in
 * a temporary directory, then hand its path to a reader. The snapshot is always
 * deleted afterwards, and the source is never modified.
 *
 * @param {Object} options
 * @param {string} options.sourcePath - Path to the source database
 * @param {function(string): (Promise<T>|T)} options.read - Reader run against the snapshot copy
 * @returns {Promise<T>}
 * @template T
 */
export async function withDatabaseSnapshot({ sourcePath, read }) {
  if (!(await pathExists(sourcePath))) {
    throw new Error(`Source database does not exist: ${sourcePath}`);
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'browser-commander-snap-'));
  const snapshotPath = path.join(dir, path.basename(sourcePath));
  const cleanupDir = () =>
    rm(dir, { recursive: true, force: true, maxRetries: 3 });

  try {
    // The backup API needs to open the source. It opens read-only, so nothing
    // is written to the user's real database.
    try {
      await backupSqliteDatabase(sourcePath, snapshotPath);
    } catch (cause) {
      throw new Error(
        `Consistent SQLite snapshot unavailable for ${sourcePath}; close the source browser and retry, or supply a consistent read-only snapshot. ${cause.message}`,
        { cause }
      );
    }
    return await read(snapshotPath);
  } finally {
    await cleanupDir();
  }
}

/**
 * Open a snapshot database read-only, run a reader, and close it.
 *
 * @param {Object} options
 * @param {string} options.sourcePath
 * @param {function(Object): (Promise<T>|T)} options.read
 * @returns {Promise<T>}
 * @template T
 */
export function readDatabaseSnapshot({ sourcePath, read }) {
  return withDatabaseSnapshot({
    sourcePath,
    read: async (snapshotPath) => {
      const db = await openSqliteDatabase(snapshotPath, {
        readOnly: true,
        fileMustExist: true,
      });
      try {
        return await read(db);
      } finally {
        db.close();
      }
    },
  });
}
