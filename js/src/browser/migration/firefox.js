import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { profileFileIfPresent } from './fs-utils.js';

import { openSqliteDatabase } from '../browser-cookie-database.js';
import { mapFirefoxCookieRows } from '../browser-cookies.js';
import { readDatabaseSnapshot } from './sqlite-snapshot.js';
import { encryptChromiumValue } from './chromium-crypto.js';
import { firefoxBookmarksToChrome } from './firefox-bookmarks.js';
import {
  PrimaryPasswordError,
  decryptFirefoxField,
  recoverFirefoxKeyFromDatabase,
} from './firefox-nss.js';

/**
 * Firefox → Chromium profile migration.
 *
 * Firefox stores its data very differently from Chromium, so each data class is
 * translated rather than copied:
 *
 * - **cookies:** read from `cookies.sqlite` (`moz_cookies`, unencrypted) and
 *   returned in the same shape as the Chromium reader so the launcher can seed
 *   them over CDP.
 * - **bookmarks:** read from `places.sqlite` (`moz_bookmarks` + `moz_places`)
 *   and converted to Chrome's `Bookmarks` JSON.
 * - **history:** counted from `places.sqlite` and reported; it is not written,
 *   because Chrome's `History` schema is incompatible with Firefox's.
 * - **passwords:** decrypted from `logins.json` with the NSS key in `key4.db`
 *   and re-encrypted into a Chrome `Login Data`. When a primary password is set
 *   and not supplied, they are reported as `primary-password-set`.
 *
 * Every database is read through a consistent read-only snapshot, so a running
 * Firefox is never disturbed.
 */

const FIREFOX_ROOT_GUIDS = Object.freeze({
  toolbar_____: 'toolbar',
  menu________: 'menu',
  unfiled_____: 'unfiled',
});

// A conservative Chrome `Login Data` schema. Chrome re-keys or upgrades this on
// first launch; the columns below are the long-stable core of the `logins`
// table plus the `meta` version marker.
const CHROME_LOGINS_SCHEMA = `
CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
INSERT INTO meta (key, value) VALUES ('version', '34');
INSERT INTO meta (key, value) VALUES ('last_compatible_version', '1');
CREATE TABLE logins (
  origin_url VARCHAR NOT NULL,
  action_url VARCHAR,
  username_element VARCHAR,
  username_value VARCHAR,
  password_element VARCHAR,
  password_value BLOB,
  submit_element VARCHAR,
  signon_realm VARCHAR NOT NULL,
  date_created INTEGER NOT NULL,
  blacklisted_by_user INTEGER NOT NULL,
  scheme INTEGER NOT NULL,
  password_type INTEGER,
  times_used INTEGER,
  form_data BLOB,
  display_name VARCHAR,
  icon_url VARCHAR,
  federation_url VARCHAR,
  skip_zero_click INTEGER,
  generation_upload_status INTEGER,
  possible_username_pairs BLOB,
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date_last_used INTEGER NOT NULL DEFAULT 0,
  moving_blocked_for BLOB,
  date_password_modified INTEGER NOT NULL DEFAULT 0,
  UNIQUE (origin_url, username_element, username_value, password_element, signon_realm)
);
`;

function signonRealm(originUrl) {
  try {
    const url = new URL(originUrl);
    return `${url.protocol}//${url.host}/`;
  } catch {
    return originUrl;
  }
}

/**
 * Read Firefox cookies from `cookies.sqlite` in the same shape as the Chromium
 * cookie reader.
 *
 * @param {Object} options
 * @param {string} options.profileDir
 * @param {string[]} [options.domains]
 * @returns {Promise<Object[]>}
 */
export async function readFirefoxCookies({ profileDir, domains }) {
  const cookiePath = await profileFileIfPresent(profileDir, 'cookies.sqlite');
  if (!cookiePath) {
    return [];
  }
  return readDatabaseSnapshot({
    sourcePath: cookiePath,
    read: (db) => {
      const rows = db
        .prepare(
          `SELECT name, value, host, path, expiry, isSecure, isHttpOnly, sameSite
             FROM moz_cookies ORDER BY host, name, path`
        )
        .all();
      // The installed-browser cookie reader owns the row → cookie mapping, so
      // a migrated cookie and an imported one always have the same shape.
      return mapFirefoxCookieRows(
        rows.filter((row) =>
          Array.isArray(domains) && domains.length > 0
            ? domains.some((domain) => (row.host ?? '').includes(domain))
            : true
        )
      );
    },
  });
}

/**
 * Convert Firefox bookmarks to a Chrome `Bookmarks` file in the target profile.
 *
 * @param {Object} options
 * @param {string} options.profileDir - Firefox source profile
 * @param {string} options.targetProfileDir
 * @returns {Promise<{migrated: number, skipped: Array, warnings: Array}>}
 */
export async function migrateFirefoxBookmarks({
  profileDir,
  targetProfileDir,
}) {
  const placesPath = await profileFileIfPresent(profileDir, 'places.sqlite');
  if (!placesPath) {
    return {
      migrated: 0,
      skipped: [
        { type: 'bookmarks', item: 'places.sqlite', reason: 'source-missing' },
      ],
      warnings: [],
    };
  }
  const rows = await readDatabaseSnapshot({
    sourcePath: placesPath,
    read: (db) =>
      db
        .prepare(
          `SELECT b.id, b.parent, b.type, b.title, b.guid, p.url
             FROM moz_bookmarks b
             LEFT JOIN moz_places p ON b.fk = p.id
            ORDER BY b.parent, b.position`
        )
        .all()
        .map((row) => ({
          id: Number(row.id),
          parent: Number(row.parent),
          type: Number(row.type),
          title: row.title,
          url: row.url,
          root: FIREFOX_ROOT_GUIDS[row.guid] ?? null,
        })),
  });
  const { document, count } = firefoxBookmarksToChrome({ rows });
  await mkdir(targetProfileDir, { recursive: true });
  await writeFile(
    path.join(targetProfileDir, 'Bookmarks'),
    JSON.stringify(document)
  );
  return { migrated: count, skipped: [], warnings: [] };
}

/**
 * Count Firefox history and report it (Chrome's schema is incompatible).
 *
 * @param {Object} options
 * @param {string} options.profileDir
 * @returns {Promise<{migrated: number, skipped: Array, warnings: Array}>}
 */
export async function reportFirefoxHistory({ profileDir }) {
  const placesPath = await profileFileIfPresent(profileDir, 'places.sqlite');
  if (!placesPath) {
    return { migrated: 0, skipped: [], warnings: [] };
  }
  const count = await readDatabaseSnapshot({
    sourcePath: placesPath,
    read: (db) =>
      Number(db.prepare('SELECT COUNT(*) AS c FROM moz_places').get().c),
  });
  return {
    migrated: 0,
    skipped: [
      {
        type: 'history',
        item: 'places.sqlite',
        reason: 'firefox-history-schema-incompatible',
      },
    ],
    warnings: [
      {
        type: 'history',
        item: 'places.sqlite',
        reason: 'not-migrated',
        detail: `Firefox has ${count} history entries; Chrome's History schema is incompatible, so history is reported but not converted.`,
      },
    ],
  };
}

/**
 * Decrypt Firefox logins and write them into a Chrome `Login Data`.
 *
 * @param {Object} options
 * @param {string} options.profileDir - Firefox source profile
 * @param {string} options.targetProfileDir
 * @param {string} options.platform
 * @param {Buffer} options.targetKey - The dedicated Chrome profile's key
 * @param {string} [options.targetPrefix]
 * @param {Buffer} [options.primaryPassword]
 * @returns {Promise<{migrated: number, skipped: Array, warnings: Array}>}
 */
export async function migrateFirefoxPasswords({
  profileDir,
  targetProfileDir,
  platform,
  targetKey,
  targetPrefix = platform === 'win32' ? 'v10' : 'v11',
  primaryPassword = Buffer.alloc(0),
}) {
  const loginsPath = await profileFileIfPresent(profileDir, 'logins.json');
  const key4Path = await profileFileIfPresent(profileDir, 'key4.db');
  if (!loginsPath || !key4Path) {
    return {
      migrated: 0,
      skipped: [
        { type: 'passwords', item: 'logins.json', reason: 'source-missing' },
      ],
      warnings: [],
    };
  }
  if (!Buffer.isBuffer(targetKey)) {
    throw new TypeError('migrateFirefoxPasswords requires a target key');
  }

  let key;
  try {
    key = await readDatabaseSnapshot({
      sourcePath: key4Path,
      read: (db) => recoverFirefoxKeyFromDatabase(db, primaryPassword),
    });
  } catch (error) {
    if (error instanceof PrimaryPasswordError) {
      return {
        migrated: 0,
        skipped: [
          {
            type: 'passwords',
            item: 'logins.json',
            reason: 'primary-password-set',
          },
        ],
        warnings: [],
      };
    }
    throw error;
  }

  const logins = JSON.parse(await readFile(loginsPath, 'utf8')).logins ?? [];
  const decrypted = [];
  const skipped = [];
  for (const login of logins) {
    try {
      decrypted.push({
        origin: login.hostname,
        username: decryptFirefoxField(login.encryptedUsername, key),
        password: decryptFirefoxField(login.encryptedPassword, key),
      });
    } catch (error) {
      skipped.push({
        type: 'passwords',
        item: login.hostname ?? '(unknown)',
        reason: 'decrypt-failed',
        detail: error.message,
      });
    }
  }

  await mkdir(targetProfileDir, { recursive: true });
  const targetPath = path.join(targetProfileDir, 'Login Data');
  const db = await openSqliteDatabase(targetPath);
  let migrated = 0;
  try {
    db.exec(CHROME_LOGINS_SCHEMA);
    const insert = db.prepare(
      `INSERT OR IGNORE INTO logins (
         origin_url, action_url, username_element, username_value,
         password_element, password_value, submit_element, signon_realm,
         date_created, blacklisted_by_user, scheme, password_type, times_used,
         date_last_used, date_password_modified
       ) VALUES (?, ?, '', ?, '', ?, '', ?, 0, 0, 0, 0, 0, 0, 0)`
    );
    for (const entry of decrypted) {
      const encrypted = encryptChromiumValue({
        plaintext: entry.password,
        key: targetKey,
        platform,
        prefix: targetPrefix,
      });
      insert.run(
        entry.origin,
        entry.origin,
        entry.username,
        encrypted,
        signonRealm(entry.origin)
      );
      migrated += 1;
    }
  } finally {
    db.close();
  }

  const warnings = [];
  if (migrated > 0) {
    warnings.push({
      type: 'passwords',
      item: 'Login Data',
      reason: 'reencrypted-for-chrome',
      detail: `${migrated} Firefox logins were decrypted and re-encrypted into a Chrome Login Data; Chrome may re-key the store on first launch.`,
    });
  }
  return { migrated, skipped, warnings };
}
