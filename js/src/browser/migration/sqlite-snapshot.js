import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathExists } from './fs-utils.js';

import BetterSqlite3 from 'better-sqlite3';

import { openSqliteDatabase } from '../browser-cookie-database.js';

/**
 * Read a Chromium SQLite database (History, Top Sites, Login Data, Web Data)
 * while the source browser is running, without ever writing to the source.
 *
 * Chrome keeps these databases open in WAL mode and, on Windows, holds a share
 * lock that stops another process from opening the file at all. Two techniques
 * cover both cases:
 *
 * 1. The SQLite Online Backup API (`better-sqlite3`'s `.backup()`), which
 *    copies a transactionally consistent snapshot even while the source is
 *    being written. This is the same mechanism `browser-cookie-database.js`
 *    relies on for a stable read, and SQLite documents it as the correct way
 *    to snapshot a live database
 *    (https://www.sqlite.org/backup.html).
 * 2. When the source cannot be opened at all (a Windows exclusive lock), the
 *    file and its `-wal`/`-journal` sidecars are copied to a temporary
 *    directory and the copy is opened instead. Copying the sidecars keeps the
 *    committed-but-not-checkpointed pages, so the copy is consistent.
 *
 * Both paths open the source with `readOnly`, so nothing is written back.
 */

const SQLITE_SIDECARS = ['-wal', '-shm', '-journal'];

/**
 * Copy a SQLite file and its sidecars into a temporary directory.
 *
 * @param {string} sourcePath
 * @returns {Promise<{snapshotPath: string, cleanup: () => Promise<void>}>}
 */
async function copyDatabaseFiles(sourcePath) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'browser-commander-snap-'));
  const base = path.basename(sourcePath);
  const snapshotPath = path.join(dir, base);
  await copyFile(sourcePath, snapshotPath);
  for (const suffix of SQLITE_SIDECARS) {
    const sidecar = `${sourcePath}${suffix}`;
    if (await pathExists(sidecar)) {
      await copyFile(sidecar, `${snapshotPath}${suffix}`);
    }
  }
  return {
    snapshotPath,
    cleanup: () => rm(dir, { recursive: true, force: true, maxRetries: 3 }),
  };
}

/**
 * Produce a consistent, read-only snapshot copy of a live Chromium database in
 * a temporary directory, then hand its path to a reader. The snapshot is always
 * deleted afterwards, and the source is never modified.
 *
 * @param {Object} options
 * @param {string} options.sourcePath - Path to the source database
 * @param {(snapshotPath: string) => Promise<T>|T} options.read - Reader run against the snapshot copy
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

  let copyFallback;
  try {
    // The backup API needs to open the source. It opens read-only, so nothing
    // is written to the user's real database.
    let source;
    try {
      source = new BetterSqlite3(sourcePath, {
        readonly: true,
        fileMustExist: true,
      });
    } catch {
      source = null;
    }
    if (source) {
      try {
        await source.backup(snapshotPath);
      } finally {
        source.close();
      }
    } else {
      // The source is locked exclusively (Windows); fall back to copying the
      // file and its sidecars, then read that copy.
      await cleanupDir();
      copyFallback = await copyDatabaseFiles(sourcePath);
    }

    const readPath = copyFallback?.snapshotPath ?? snapshotPath;
    return await read(readPath);
  } finally {
    if (copyFallback) {
      await copyFallback.cleanup();
    } else {
      await cleanupDir();
    }
  }
}

/**
 * Open a snapshot database read-only, run a reader, and close it.
 *
 * @param {Object} options
 * @param {string} options.sourcePath
 * @param {(db: Object) => Promise<T>|T} options.read
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
