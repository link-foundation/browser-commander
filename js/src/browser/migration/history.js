import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathExists } from './fs-utils.js';

import { withDatabaseSnapshot } from './sqlite-snapshot.js';

/**
 * History and Top Sites migration.
 *
 * Chrome keeps browsing history in the `History` SQLite database and the
 * new-tab-page thumbnails/most-visited list in `Top Sites`. Both are open and
 * write-locked while Chrome runs, so a migration takes a consistent snapshot
 * through the SQLite Online Backup API (see `sqlite-snapshot.js`) and writes
 * the snapshot into the target profile. The source is opened read-only and is
 * never modified.
 *
 * The snapshot is copied verbatim rather than rebuilt row by row: `History`
 * carries interdependent tables (`urls`, `visits`, `visit_source`,
 * `segments`, ...) whose foreign keys must stay consistent, and the backup API
 * already guarantees a point-in-time consistent copy.
 */

function snapshotInto({ sourcePath, targetPath }) {
  return withDatabaseSnapshot({
    sourcePath,
    read: async (snapshotPath) => {
      const { copyFile } = await import('node:fs/promises');
      await copyFile(snapshotPath, targetPath);
      // Best-effort URL count for the report.
      try {
        const { openSqliteDatabase } =
          await import('../browser-cookie-database.js');
        const db = await openSqliteDatabase(targetPath, { readOnly: true });
        try {
          const row = db.prepare('SELECT COUNT(*) AS c FROM urls').get();
          return Number(row?.c ?? 0);
        } finally {
          db.close();
        }
      } catch {
        return null;
      }
    },
  });
}

/**
 * Migrate History (and Top Sites) into the target profile.
 *
 * @param {Object} options
 * @param {string} options.sourceProfileDir
 * @param {string} options.targetProfileDir
 * @returns {Promise<{migrated: number, skipped: Array, warnings: Array}>}
 */
export async function migrateHistory({ sourceProfileDir, targetProfileDir }) {
  const skipped = [];
  const warnings = [];
  await mkdir(targetProfileDir, { recursive: true });

  const historySource = path.join(sourceProfileDir, 'History');
  let urlCount = 0;
  let migratedDatabases = 0;
  if (await pathExists(historySource)) {
    const count = await snapshotInto({
      sourcePath: historySource,
      targetPath: path.join(targetProfileDir, 'History'),
    });
    urlCount = count ?? 0;
    migratedDatabases += 1;
  } else {
    skipped.push({
      type: 'history',
      item: 'History',
      reason: 'source-missing',
    });
  }

  const topSitesSource = path.join(sourceProfileDir, 'Top Sites');
  if (await pathExists(topSitesSource)) {
    await snapshotInto({
      sourcePath: topSitesSource,
      targetPath: path.join(targetProfileDir, 'Top Sites'),
    });
    migratedDatabases += 1;
  }

  // The report counts the snapshot as one migrated unit (matching the docs
  // example `"history": 1`), and carries the URL count as a warning detail so
  // it is visible without changing the report shape.
  if (urlCount > 0) {
    warnings.push({
      type: 'history',
      item: 'History',
      reason: 'snapshot-copied',
      detail: `${urlCount} history URLs copied via the SQLite backup API`,
    });
  }
  return {
    migrated: migratedDatabases > 0 ? 1 : 0,
    skipped,
    warnings,
  };
}
