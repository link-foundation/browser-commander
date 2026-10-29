import path from 'node:path';
import { copyFile } from 'node:fs/promises';
import { pathExists } from './fs-utils.js';

import { decryptChromiumCookie } from '../browser-cookie-crypto.js';
import {
  openSqliteDatabase,
  preserveIntegerPrecision,
} from '../browser-cookie-database.js';
import { withDatabaseSnapshot } from './sqlite-snapshot.js';
import { encryptChromiumValue } from './chromium-crypto.js';
import { matchesDomains } from './domains.js';
import { migratePasswordMetadata } from './password-metadata.js';
import { withPasswordStore, preflightPasswordStore } from './password-store.js';

/**
 * Saved-password migration.
 *
 * Chrome stores saved passwords in the `Login Data` SQLite database, in the
 * `logins` table, with `password_value` encrypted exactly like a cookie's
 * `encrypted_value` (the same OSCrypt keys), except that `Login Data` values
 * never carry the SHA-256(host) domain-hash prefix the Cookies database adds at
 * schema version 24.
 *
 * Passwords are prepared in a private snapshot, then merged into compatible
 * closed target stores. Existing target identities win; see password-store.js.
 * A failed preparation never replaces the target database.
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

async function rewriteSecret(
  value,
  origin,
  { platform, resolveSourceKey, targetKey, targetPrefix }
) {
  const encryptedValue = toBuffer(value);
  if (!encryptedValue.length) {
    return { value: encryptedValue };
  }
  const prefix = encryptedValue.subarray(0, 3).toString('ascii');
  if (prefix === 'v20') {
    return { reason: 'app-bound-v20' };
  }
  if (prefix !== 'v10' && prefix !== 'v11') {
    return { reason: 'unsupported-encryption' };
  }
  let plaintext;
  try {
    plaintext = decryptChromiumCookie({
      encryptedValue,
      host: hostFromOrigin(origin),
      databaseVersion: 0,
      platform,
      key: await resolveSourceKey(prefix),
    });
  } catch {
    return { reason: 'decrypt-failed' };
  }
  return {
    value: encryptChromiumValue({
      plaintext,
      key: targetKey,
      platform,
      prefix: targetPrefix,
    }),
  };
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
  targetPrefix = platform === 'linux' ? 'v11' : 'v10',
  domains,
}) {
  await preflightPasswordStore(sourceProfileDir, targetProfileDir);
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

  return withPasswordStore({
    sourceProfileDir,
    targetProfileDir,
    targetKey,
    platform,
    prepare: (targetPath) =>
      withDatabaseSnapshot({
        sourcePath,
        read: async (snapshotPath) => {
          // Prepare source records with their original schema before merging.
          await copyFile(snapshotPath, targetPath);
          const db = await openSqliteDatabase(targetPath, {
            fileMustExist: true,
          });
          const skipped = [];
          const warnings = [];
          let migrated = 0;
          try {
            const rows = preserveIntegerPrecision(
              db.prepare(
                'SELECT rowid AS rowid, origin_url, password_value FROM logins'
              )
            ).all();
            const update = db.prepare(
              'UPDATE logins SET password_value = ? WHERE rowid = ?'
            );
            const remove = db.prepare('DELETE FROM logins WHERE rowid = ?');
            const skip = (row, reason, detail) => {
              remove.run(row.rowid);
              skipped.push({
                type: 'passwords',
                item: 'Login Data',
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
              const result = await rewriteSecret(
                encryptedValue,
                row.origin_url,
                {
                  platform,
                  resolveSourceKey,
                  targetKey,
                  targetPrefix,
                }
              );
              if (result.reason) {
                skip(row, result.reason, result.detail);
                continue;
              }
              update.run(result.value, row.rowid);
              migrated += 1;
            }
            await migratePasswordMetadata({
              db,
              domains,
              skipped,
              warnings,
              rewriteValue: (value, origin) =>
                rewriteSecret(value, origin, {
                  platform,
                  resolveSourceKey,
                  targetKey,
                  targetPrefix,
                }),
            });
            db.exec('VACUUM');
          } finally {
            db.close();
          }
          return { migrated, skipped, warnings };
        },
      }),
  });
}
