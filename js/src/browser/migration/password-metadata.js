import { matchesDomains } from './domains.js';

/** Filter Login Data associations after pruning logins; never retain source keys. */
export async function migratePasswordMetadata({
  db,
  domains,
  rewriteValue,
  skipped,
  warnings,
}) {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((row) => row.name);
  for (const table of ['password_notes', 'insecure_credentials']) {
    if (tables.includes(table)) {
      db.exec(
        `DELETE FROM ${table} WHERE NOT EXISTS (SELECT 1 FROM logins WHERE logins.id=${table}.parent_id)`
      );
    }
  }
  if (tables.includes('password_notes')) {
    const rows = db
      .prepare(
        'SELECT password_notes.rowid AS rowid,logins.origin_url,password_notes.value FROM password_notes JOIN logins ON logins.id=password_notes.parent_id'
      )
      .all();
    for (const row of rows) {
      const result = await rewriteValue(row.value, row.origin_url);
      if (result.reason) {
        db.prepare('DELETE FROM password_notes WHERE rowid=?').run(row.rowid);
        skipped.push({
          type: 'passwords',
          item: `password_notes/${row.rowid}`,
          ...result,
        });
      } else {
        db.prepare('UPDATE password_notes SET value=? WHERE rowid=?').run(
          result.value,
          row.rowid
        );
      }
    }
  }
  const syncTables = [
    'sync_entities_metadata',
    'sync_model_metadata',
    'incoming_sharing_invitation_sync_entities_metadata',
    'incoming_sharing_invitation_sync_model_metadata',
  ];
  for (const table of syncTables) {
    if (tables.includes(table)) {
      resetMetadata(db, table, 'sync-metadata-reset', warnings);
    }
  }
  if (!domains?.length) {
    return;
  }
  if (tables.includes('stats')) {
    for (const row of db
      .prepare('SELECT rowid AS rowid,origin_domain FROM stats')
      .all()) {
      if (!matchesDomains(row.origin_domain ?? '', domains)) {
        db.prepare('DELETE FROM stats WHERE rowid=?').run(row.rowid);
      }
    }
  }
  const known = new Set([
    'logins',
    'meta',
    'password_notes',
    'insecure_credentials',
    'stats',
    ...syncTables,
  ]);
  for (const table of tables) {
    if (!known.has(table) && !table.startsWith('sqlite_')) {
      resetMetadata(db, table, 'unsupported-password-metadata', warnings);
    }
  }
}

function resetMetadata(db, table, reason, warnings) {
  // Only the identifier comes from the database; quote it rather than execute it.
  const quoted = `"${table.replaceAll('"', '""')}"`;
  const { changes } = db.prepare(`DELETE FROM ${quoted}`).run();
  if (changes) {
    warnings.push({
      type: 'passwords',
      item: table,
      reason,
      detail: `${changes} copied metadata rows removed`,
    });
  }
}
