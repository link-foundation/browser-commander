import assert from 'node:assert';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import BetterSqlite3 from 'better-sqlite3';

import {
  migrateFirefoxBookmarks,
  migrateFirefoxPasswords,
  readFirefoxCookies,
  reportFirefoxHistory,
} from '../../../../src/browser/migration/firefox.js';
import {
  decryptChromiumCookie,
  deriveChromiumCookieKey,
} from '../../../../src/browser/browser-cookie-crypto.js';
import {
  buildKey4Database,
  buildLoginsJson,
} from '../../../fixtures/firefox-nss-fixtures.mjs';

const tempDirs = [];

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bc-ff-'));
  tempDirs.push(dir);
  return dir;
}

function writeCookies(dir, rows) {
  const db = new BetterSqlite3(path.join(dir, 'cookies.sqlite'));
  db.exec(
    `CREATE TABLE moz_cookies (name TEXT, value TEXT, host TEXT, path TEXT,
       expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER)`
  );
  const insert = db.prepare(
    `INSERT INTO moz_cookies (name, value, host, path, expiry, isSecure, isHttpOnly, sameSite)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
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
  db.close();
}

function writePlaces(dir) {
  const db = new BetterSqlite3(path.join(dir, 'places.sqlite'));
  db.exec(
    `CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT);
     CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER,
       parent INTEGER, position INTEGER, title TEXT, guid TEXT);`
  );
  db.prepare('INSERT INTO moz_places (id, url) VALUES (?, ?)').run(
    10,
    'https://toolbar.example/'
  );
  db.prepare('INSERT INTO moz_places (id, url) VALUES (?, ?)').run(
    11,
    'https://menu.example/'
  );
  const insertBookmark = db.prepare(
    'INSERT INTO moz_bookmarks (id, type, fk, parent, position, title, guid) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  insertBookmark.run(1, 2, null, 0, 0, '', 'root________');
  insertBookmark.run(3, 2, null, 1, 0, 'Bookmarks Toolbar', 'toolbar_____');
  insertBookmark.run(2, 2, null, 1, 1, 'Bookmarks Menu', 'menu________');
  insertBookmark.run(100, 1, 10, 3, 0, 'Toolbar Site', 'aaaaaaaaaaaa');
  insertBookmark.run(101, 1, 11, 2, 0, 'Menu Site', 'bbbbbbbbbbbb');
  db.close();
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('readFirefoxCookies', () => {
  it('reads and maps cookies, applying the domain filter', async () => {
    const dir = await makeTempDir();
    writeCookies(dir, [
      { name: 'a', value: '1', host: '.example.com', secure: true },
      { name: 'b', value: '2', host: '.other.com' },
    ]);
    const all = await readFirefoxCookies({ profileDir: dir });
    assert.equal(all.length, 2);
    const filtered = await readFirefoxCookies({
      profileDir: dir,
      domains: ['example.com'],
    });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].domain, '.example.com');
    assert.equal(filtered[0].secure, true);
  });

  it('returns an empty list when there is no cookies.sqlite', async () => {
    const dir = await makeTempDir();
    assert.deepEqual(await readFirefoxCookies({ profileDir: dir }), []);
  });
});

describe('migrateFirefoxBookmarks', () => {
  it('converts places bookmarks into a Chrome Bookmarks document', async () => {
    const source = await makeTempDir();
    const target = await makeTempDir();
    writePlaces(source);
    const report = await migrateFirefoxBookmarks({
      profileDir: source,
      targetProfileDir: target,
    });
    assert.equal(report.migrated, 2);
    const doc = JSON.parse(
      await readFile(path.join(target, 'Bookmarks'), 'utf8')
    );
    assert.equal(
      doc.roots.bookmark_bar.children[0].url,
      'https://toolbar.example/'
    );
    assert.equal(doc.roots.other.children[0].url, 'https://menu.example/');
  });
});

describe('reportFirefoxHistory', () => {
  it('counts places history and reports it as not migrated', async () => {
    const source = await makeTempDir();
    writePlaces(source);
    const report = await reportFirefoxHistory({ profileDir: source });
    assert.equal(report.migrated, 0);
    assert.equal(
      report.skipped[0].reason,
      'firefox-history-schema-incompatible'
    );
    assert.match(report.warnings[0].detail, /2 history entries/);
  });
});

describe('migrateFirefoxPasswords', () => {
  it('decrypts logins and re-encrypts them into a Chrome Login Data', async () => {
    const source = await makeTempDir();
    const target = await makeTempDir();
    const { key4Path, loginKey } = buildKey4Database({ dir: source });
    assert.equal(key4Path, path.join(source, 'key4.db'));
    await writeFile(
      path.join(source, 'logins.json'),
      buildLoginsJson({
        key: loginKey,
        entries: [
          {
            hostname: 'https://a.example',
            username: 'alice',
            password: 'secret-A',
          },
        ],
      })
    );

    const targetKey = deriveChromiumCookieKey('target-pass', 'linux');
    const report = await migrateFirefoxPasswords({
      profileDir: source,
      targetProfileDir: target,
      platform: 'linux',
      targetKey,
      targetPrefix: 'v11',
    });
    assert.equal(report.migrated, 1);

    const db = new BetterSqlite3(path.join(target, 'Login Data'), {
      readonly: true,
    });
    const row = db
      .prepare('SELECT username_value, password_value, origin_url FROM logins')
      .get();
    db.close();
    assert.equal(row.username_value, 'alice');
    const decrypted = decryptChromiumCookie({
      encryptedValue: row.password_value,
      host: 'a.example',
      databaseVersion: 0,
      platform: 'linux',
      key: targetKey,
    });
    assert.equal(decrypted, 'secret-A');
  });

  it('reports primary-password-set when the key is locked', async () => {
    const source = await makeTempDir();
    const target = await makeTempDir();
    const { loginKey } = buildKey4Database({
      dir: source,
      primaryPassword: Buffer.from('locked'),
    });
    await writeFile(
      path.join(source, 'logins.json'),
      buildLoginsJson({
        key: loginKey,
        entries: [
          { hostname: 'https://a.example', username: 'a', password: 'b' },
        ],
      })
    );
    const report = await migrateFirefoxPasswords({
      profileDir: source,
      targetProfileDir: target,
      platform: 'linux',
      targetKey: deriveChromiumCookieKey('t', 'linux'),
    });
    assert.equal(report.migrated, 0);
    assert.equal(report.skipped[0].reason, 'primary-password-set');
  });

  it('reports source-missing when there is no logins.json', async () => {
    const source = await makeTempDir();
    const target = await makeTempDir();
    const report = await migrateFirefoxPasswords({
      profileDir: source,
      targetProfileDir: target,
      platform: 'linux',
      targetKey: deriveChromiumCookieKey('t', 'linux'),
    });
    assert.equal(report.skipped[0].reason, 'source-missing');
  });
});
