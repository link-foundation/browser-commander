import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathExists } from './fs-utils.js';

import { withDatabaseSnapshot } from './sqlite-snapshot.js';
import { matchesDomains } from './domains.js';
import { openSqliteDatabase } from '../browser-cookie-database.js';

async function filterHistory(targetPath, domains) {
  if (!domains?.length) {
    return;
  }
  const db = await openSqliteDatabase(targetPath);
  try {
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name)
    );
    if (tables.has('urls')) {
      const remove = db.prepare('DELETE FROM urls WHERE id = ?');
      for (const row of db.prepare('SELECT id,url FROM urls').all()) {
        if (!matchesDomains(row.url, domains)) {
          remove.run(row.id);
        }
      }
      for (const [table, column] of [
        ['visits', 'url'],
        ['segments', 'url_id'],
        ['keyword_search_terms', 'url_id'],
      ]) {
        if (tables.has(table)) {
          db.exec(
            `DELETE FROM ${table} WHERE ${column} NOT IN (SELECT id FROM urls)`
          );
        }
      }
      if (tables.has('visits')) {
        for (const [table, column] of [
          ['visit_source', 'id'],
          ['content_annotations', 'visit_id'],
          ['context_annotations', 'visit_id'],
          ['clusters_and_visits', 'visit_id'],
        ]) {
          if (tables.has(table)) {
            db.exec(
              `DELETE FROM ${table} WHERE ${column} NOT IN (SELECT id FROM visits)`
            );
          }
        }
      }
      if (tables.has('segments') && tables.has('segment_usage')) {
        db.exec(
          'DELETE FROM segment_usage WHERE segment_id NOT IN (SELECT id FROM segments)'
        );
      }
    }
    filterDownloads(db, tables, domains);
    if (tables.has('top_sites')) {
      const remove = db.prepare('DELETE FROM top_sites WHERE url = ?');
      for (const row of db.prepare('SELECT url FROM top_sites').all()) {
        if (!matchesDomains(row.url, domains)) {
          remove.run(row.url);
        }
      }
    }
    db.exec('VACUUM');
  } finally {
    db.close();
  }
}

function filterDownloads(db, tables, domains) {
  if (!tables.has('downloads')) {
    return;
  }
  const remove = db.prepare('DELETE FROM downloads WHERE id = ?');
  for (const row of db.prepare('SELECT * FROM downloads').all()) {
    const urls = ['url', 'site_url', 'tab_url', 'referrer', 'tab_referrer_url']
      .map((column) => row[column])
      .filter(Boolean);
    if (tables.has('downloads_url_chains')) {
      urls.push(
        ...db
          .prepare('SELECT url FROM downloads_url_chains WHERE id = ?')
          .all(row.id)
          .map((chain) => chain.url)
      );
    }
    // A redirect outside the selected sites is still unrelated browsing data.
    if (!urls.length || urls.some((url) => !matchesDomains(url, domains))) {
      remove.run(row.id);
    }
  }
  for (const [table, column] of [
    ['downloads_url_chains', 'id'],
    ['downloads_slices', 'download_id'],
  ]) {
    if (tables.has(table)) {
      db.exec(
        `DELETE FROM ${table} WHERE ${column} NOT IN (SELECT id FROM downloads)`
      );
    }
  }
}

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

function snapshotInto({ sourcePath, targetPath, domains }) {
  return withDatabaseSnapshot({
    sourcePath,
    read: async (snapshotPath) => {
      const { copyFile } = await import('node:fs/promises');
      await copyFile(snapshotPath, targetPath);
      await filterHistory(targetPath, domains);
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
export async function migrateHistory({
  sourceProfileDir,
  targetProfileDir,
  domains,
}) {
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
      domains,
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
      domains,
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
