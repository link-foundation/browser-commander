import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathExists } from './fs-utils.js';

import { decryptChromiumCookie } from '../browser-cookie-crypto.js';
import { openSqliteDatabase } from '../browser-cookie-database.js';
import { withDatabaseSnapshot } from './sqlite-snapshot.js';
import { encryptChromiumValue } from './chromium-crypto.js';
import { matchesDomains } from './domains.js';

/**
 * Saved-password migration.
 *
 * Chrome stores saved passwords in the `Login Data` SQLite database, in the
 * `logins` table, with `password_value` encrypted exactly like a cookie's
 * `encrypted_value` (the same OSCrypt keys), except that `Login Data` values
 * never carry the SHA-256(host) domain-hash prefix the Cookies database adds at
 * schema version 24.
 *
 * Passwords cannot be re-seeded over CDP the way cookies can, so the migration
 * writes a target `Login Data` directly:
 *
 * 1. Take a consistent, read-only snapshot of the source `Login Data` with the
 *    SQLite Online Backup API (never writing to the running source).
 * 2. Copy that snapshot to the target path, which preserves Chrome's exact
 *    schema (tables, indexes, `meta` version rows) verbatim.
 * 3. Decrypt each `password_value` with the source profile's key and
 *    re-encrypt it with the dedicated target profile's key, updating the row
 *    in place. Because only the values are rewritten, the schema Chrome expects
 *    is untouched.
 *
 * The source key handling, the target key, and the platform are all injected so
 * the whole path is unit-testable on Linux with a fabricated key. Windows
 * app-bound `v20` values cannot be decrypted outside the browser and are
 * reported in `skipped` rather than failing the migration.
 */

function toBuffer(value) {
  if (value === undefined || value === null) {
    return Buffer.alloc(0);
  }
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

function hostFromOrigin(originUrl) {
  try {
    return new URL(originUrl).hostname;
  } catch {
    return originUrl ?? '';
  }
}

/**
 * Migrate saved passwords into the target profile's `Login Data`.
 *
 * @param {Object} options
 * @param {string} options.sourceProfileDir
 * @param {string} options.targetProfileDir
 * @param {string} [options.platform=process.platform]
 * @param {function(string): (Promise<Buffer>|Buffer)} options.resolveSourceKey
 *   Resolve the source decryption key for an encryption prefix (v10/v11).
 * @param {Buffer} options.targetKey - The dedicated profile's encryption key.
 * @param {string} [options.targetPrefix] - Version prefix to write (v10/v11).
 * @returns {Promise<{migrated: number, skipped: Array, warnings: Array}>}
 */
export async function migratePasswords({
  sourceProfileDir,
  targetProfileDir,
  platform = process.platform,
  resolveSourceKey,
  targetKey,
  targetPrefix = platform === 'win32' ? 'v10' : 'v11',
  domains,
}) {
  const sourcePath = path.join(sourceProfileDir, 'Login Data');
  if (!(await pathExists(sourcePath))) {
    return {
      migrated: 0,
      skipped: [
        { type: 'passwords', item: 'Login Data', reason: 'source-missing' },
      ],
      warnings: [],
    };
  }
  if (typeof resolveSourceKey !== 'function') {
    throw new TypeError(
      'migratePasswords requires a resolveSourceKey function'
    );
  }
  if (!Buffer.isBuffer(targetKey)) {
    throw new TypeError('migratePasswords requires a target encryption key');
  }

  await mkdir(targetProfileDir, { recursive: true });
  const targetPath = path.join(targetProfileDir, 'Login Data');

  return withDatabaseSnapshot({
    sourcePath,
    read: async (snapshotPath) => {
      // The snapshot copy preserves Chrome's exact schema; re-encrypt values in
      // place so the target keeps whatever schema version this Chrome build
      // wrote.
      await copyFile(snapshotPath, targetPath);
      const db = await openSqliteDatabase(targetPath, { fileMustExist: true });
      const skipped = [];
      const warnings = [];
      let migrated = 0;
      try {
        const rows = db
          .prepare(
            'SELECT rowid AS rowid, origin_url, password_value FROM logins'
          )
          .all();
        const update = db.prepare(
          'UPDATE logins SET password_value = ? WHERE rowid = ?'
        );
        const remove = db.prepare('DELETE FROM logins WHERE rowid = ?');
        const skip = (row, reason, detail) => {
          remove.run(row.rowid);
          skipped.push({
            type: 'passwords',
            item: row.origin_url ?? '(unknown)',
            reason,
            ...(detail ? { detail } : {}),
          });
        };
        for (const row of rows) {
          if (!matchesDomains(row.origin_url ?? '', domains)) {
            remove.run(row.rowid);
            continue;
          }
          const encryptedValue = toBuffer(row.password_value);
          if (encryptedValue.length === 0) {
            continue;
          }
          const prefix = encryptedValue.subarray(0, 3).toString('ascii');
          if (prefix === 'v20') {
            skip(row, 'app-bound-v20');
            continue;
          }
          if (prefix !== 'v10' && prefix !== 'v11') {
            skip(row, 'unsupported-encryption');
            continue;
          }
          let plaintext;
          try {
            const key = await resolveSourceKey(prefix);
            plaintext = decryptChromiumCookie({
              encryptedValue,
              host: hostFromOrigin(row.origin_url),
              databaseVersion: 0,
              platform,
              key,
            });
          } catch (error) {
            skip(row, 'decrypt-failed', error.message);
            continue;
          }
          const reencrypted = encryptChromiumValue({
            plaintext,
            key: targetKey,
            platform,
            prefix: targetPrefix,
          });
          update.run(reencrypted, row.rowid);
          migrated += 1;
        }
        db.exec('VACUUM');
      } finally {
        db.close();
      }
      return { migrated, skipped, warnings };
    },
  });
}
