/**
 * Profile fixtures for the migration tests.
 *
 * Every migration suite moves data from a source profile into a target one and
 * checks the same report shape, and the Firefox suites (plus the installed
 * browser cookie reader) need the same `cookies.sqlite`, `places.sqlite` and
 * `logins.json` files, so they are built here once instead of per test file.
 */

import assert from 'node:assert';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import BetterSqlite3 from 'better-sqlite3';

import { decryptChromiumCookie } from '../../src/browser/browser-cookie-crypto.js';
import { openSqliteDatabase } from '../../src/browser/browser-cookie-database.js';
import {
  buildKey4Database,
  buildLoginsJson,
} from '../fixtures/firefox-nss-fixtures.mjs';

/**
 * Run a Chromium migration step from one profile directory into another.
 *
 * @param {Function} migrate - A `migrate*` data-class function
 * @param {string} source - Source profile directory
 * @param {string} target - Target profile directory
 * @param {Object} [options] - Extra options for the step
 * @returns {Promise<Object>} The step's report
 */
export function migrateBetween(migrate, source, target, options = {}) {
  return migrate({
    sourceProfileDir: source,
    targetProfileDir: target,
    ...options,
  });
}

/**
 * Assert that a step migrated nothing, and why.
 *
 * @param {Object} report - A data-class report
 * @param {string} reason - The expected first skip reason
 */
export function assertNothingMigrated(report, reason) {
  assert.equal(report.migrated, 0);
  assert.equal(report.skipped[0].reason, reason);
}

/**
 * Assert that `action` leaves a source file untouched. Migration only ever
 * reads a snapshot of the source, so its modification time must not move.
 *
 * @param {string} filePath - The source file
 * @param {() => Promise<void>} action
 */
export async function assertSourceUnchanged(filePath, action) {
  const before = (await stat(filePath)).mtimeMs;
  await action();
  const after = (await stat(filePath)).mtimeMs;
  assert.equal(before, after);
}

/**
 * Write a JSON profile file such as `Bookmarks` or `Preferences`.
 *
 * @param {string} profileDir
 * @param {string} name - File name relative to the profile
 * @param {*} value - Serialised with `JSON.stringify`
 * @returns {Promise<void>}
 */
export function writeProfileJson(profileDir, name, value) {
  return writeFile(path.join(profileDir, name), JSON.stringify(value));
}

/**
 * Read and parse a JSON profile file a migration wrote.
 *
 * @param {string} profileDir
 * @param {string} name - File name relative to the profile
 * @returns {Promise<*>}
 */
export async function readProfileJson(profileDir, name) {
  return JSON.parse(await readFile(path.join(profileDir, name), 'utf8'));
}

/**
 * Write a Chromium `History` database with `urlCount` visited URLs.
 *
 * @param {string} profileDir - Chromium profile directory
 * @param {number} urlCount
 * @returns {string} The database path
 */
export function writeChromiumHistory(profileDir, urlCount) {
  const historyPath = path.join(profileDir, 'History');
  const db = new BetterSqlite3(historyPath);
  db.exec('CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT)');
  const insert = db.prepare('INSERT INTO urls (url, title) VALUES (?, ?)');
  for (let i = 0; i < urlCount; i += 1) {
    insert.run(`https://example.com/${i}`, `Page ${i}`);
  }
  db.close();
  return historyPath;
}

/**
 * Write a Firefox `cookies.sqlite` holding the given rows.
 *
 * @param {string} profileDir - Firefox profile directory
 * @param {Array<Object>} rows - `{name, value, host}` plus optional `path`,
 *   `expiry`, `secure`, `httpOnly` and `sameSite`
 * @returns {Promise<string>} The database path
 */
export async function writeFirefoxCookies(profileDir, rows) {
  const cookiePath = path.join(profileDir, 'cookies.sqlite');
  const database = await openSqliteDatabase(cookiePath);
  database.exec(`
    CREATE TABLE moz_cookies (
      name TEXT,
      value TEXT,
      host TEXT,
      path TEXT,
      expiry INTEGER,
      isSecure INTEGER,
      isHttpOnly INTEGER,
      sameSite INTEGER
    );
  `);
  const insert = database.prepare(`
    INSERT INTO moz_cookies
      (name, value, host, path, expiry, isSecure, isHttpOnly, sameSite)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of rows) {
    insert.run(
      row.name,
      row.value,
      row.host,
      row.path ?? '/',
      row.expiry ?? 0,
      row.secure ? 1 : 0,
      row.httpOnly ? 1 : 0,
      row.sameSite ?? 0
    );
  }
  database.close();
  return cookiePath;
}

/**
 * Write a Linux Firefox-family install under `home` with one default profile,
 * listed in `profiles.ini`, whose `cookies.sqlite` holds `rows`.
 *
 * @param {string} home - Home directory the install lives under
 * @param {Array<Object>} rows - Cookie rows, as for `writeFirefoxCookies`
 * @param {Object} [options]
 * @param {string} [options.root='.mozilla/firefox'] - Install root, relative
 *   to `home` (a fork such as LibreWolf uses its own)
 * @param {string} [options.name='default-release'] - Profile name
 * @returns {Promise<string>} The profile directory
 */
export async function writeFirefoxProfile(
  home,
  rows,
  { root = '.mozilla/firefox', name = 'default-release' } = {}
) {
  const rootPath = path.join(home, ...root.split('/'));
  const profileName = `xyz.${name}`;
  const profilePath = path.join(rootPath, profileName);
  await mkdir(profilePath, { recursive: true });
  await writeFile(
    path.join(rootPath, 'profiles.ini'),
    `[Profile0]\nName=${name}\nIsRelative=1\nPath=${profileName}\nDefault=1\n`
  );
  await writeFirefoxCookies(profilePath, rows);
  return profilePath;
}

/**
 * Write a Firefox `places.sqlite` with a toolbar bookmark and, unless
 * `withMenuBookmark` is false, a bookmarks-menu one. Each bookmark has its own
 * `moz_places` row, so the history count equals the bookmark count.
 *
 * @param {string} profileDir - Firefox profile directory
 * @param {Object} [options]
 * @param {boolean} [options.withMenuBookmark=true]
 */
export function writeFirefoxPlaces(
  profileDir,
  { withMenuBookmark = true } = {}
) {
  const db = new BetterSqlite3(path.join(profileDir, 'places.sqlite'));
  db.exec(
    `CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT);
     CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER,
       parent INTEGER, position INTEGER, title TEXT, guid TEXT);`
  );
  const insertPlace = db.prepare(
    'INSERT INTO moz_places (id, url) VALUES (?, ?)'
  );
  const insertBookmark = db.prepare(
    'INSERT INTO moz_bookmarks (id, type, fk, parent, position, title, guid) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  insertBookmark.run(1, 2, null, 0, 0, '', 'root________');
  insertBookmark.run(3, 2, null, 1, 0, 'Bookmarks Toolbar', 'toolbar_____');
  insertPlace.run(10, 'https://toolbar.example/');
  insertBookmark.run(100, 1, 10, 3, 0, 'Toolbar Site', 'aaaaaaaaaaaa');
  if (withMenuBookmark) {
    insertBookmark.run(2, 2, null, 1, 1, 'Bookmarks Menu', 'menu________');
    insertPlace.run(11, 'https://menu.example/');
    insertBookmark.run(101, 1, 11, 2, 0, 'Menu Site', 'bbbbbbbbbbbb');
  }
  db.close();
}

/**
 * Write a Firefox `key4.db` and a `logins.json` encrypted with its login key.
 *
 * @param {string} profileDir - Firefox profile directory
 * @param {Object} options
 * @param {Array<{hostname: string, username: string, password: string}>} options.entries
 * @param {Buffer} [options.primaryPassword] - Locks the key when set
 * @returns {Promise<{key4Path: string, loginKey: Buffer}>}
 */
export async function writeFirefoxLogins(
  profileDir,
  { entries, primaryPassword }
) {
  const fixture = buildKey4Database({ dir: profileDir, primaryPassword });
  await writeFile(
    path.join(profileDir, 'logins.json'),
    buildLoginsJson({ key: fixture.loginKey, entries })
  );
  return fixture;
}

/**
 * Read back the logins a migration wrote to a target `Login Data`, decrypting
 * each password with the target profile's key (Linux `v10`/`v11` scheme).
 *
 * @param {string} targetProfileDir
 * @param {Buffer} targetKey
 * @returns {Array<{origin: string, username: string, password: string}>}
 *   Sorted by origin
 */
export function readMigratedLogins(targetProfileDir, targetKey) {
  const db = new BetterSqlite3(path.join(targetProfileDir, 'Login Data'), {
    readonly: true,
  });
  try {
    return db
      .prepare(
        'SELECT origin_url, username_value, password_value FROM logins ORDER BY origin_url'
      )
      .all()
      .map((row) => ({
        origin: row.origin_url,
        username: row.username_value,
        password: decryptChromiumCookie({
          encryptedValue: row.password_value,
          host: new URL(row.origin_url).hostname,
          databaseVersion: 0,
          platform: 'linux',
          key: targetKey,
        }),
      }));
  } finally {
    db.close();
  }
}
