import assert from 'node:assert';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import BetterSqlite3 from 'better-sqlite3';

import {
  ALL_DATA_CLASSES,
  migrateProfile,
} from '../../../../src/browser/migration/index.js';
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
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bc-orch-'));
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
    insert.run(row.name, row.value, row.host, '/', 0, 0, 0, 0);
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
  const insertBookmark = db.prepare(
    'INSERT INTO moz_bookmarks (id, type, fk, parent, position, title, guid) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  insertBookmark.run(1, 2, null, 0, 0, '', 'root________');
  insertBookmark.run(3, 2, null, 1, 0, 'Toolbar', 'toolbar_____');
  insertBookmark.run(100, 1, 10, 3, 0, 'Toolbar Site', 'aaaaaaaaaaaa');
  db.close();
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('migrateProfile', () => {
  it('validates required options', async () => {
    await assert.rejects(
      () => migrateProfile({ to: '/tmp/x' }),
      /from\.browser/
    );
    await assert.rejects(
      () => migrateProfile({ from: { browser: 'chrome' } }),
      /target directory/
    );
  });

  it('migrates a Firefox source and returns the documented report shape', async () => {
    const source = await makeTempDir();
    const target = await makeTempDir();
    writeCookies(source, [{ name: 'a', value: '1', host: '.example.com' }]);
    writePlaces(source);
    const { loginKey } = buildKey4Database({ dir: source });
    await writeFile(
      path.join(source, 'logins.json'),
      buildLoginsJson({
        key: loginKey,
        entries: [
          { hostname: 'https://a.example', username: 'alice', password: 'pw' },
        ],
      })
    );

    const targetKey = deriveChromiumCookieKey('target-pass', 'linux');
    const report = await migrateProfile({
      from: { browser: 'firefox', userDataDir: source },
      to: target,
      platform: 'linux',
      keys: { targetKey, targetPrefix: 'v11' },
    });

    // Exact report shape.
    assert.deepEqual(
      Object.keys(report.migrated).sort(),
      [...ALL_DATA_CLASSES].sort()
    );
    assert.equal(report.source.browser, 'firefox');
    assert.equal(report.target, target);
    assert.ok(Array.isArray(report.skipped));
    assert.ok(Array.isArray(report.warnings));

    assert.equal(report.migrated.cookies, 1);
    assert.equal(report.migrated.bookmarks, 1);
    assert.equal(report.migrated.passwords, 1);
    // Firefox history cannot be migrated into Chrome's schema.
    assert.equal(report.migrated.history, 0);
    assert.equal(report.migrated.preferences, 0);
    assert.equal(report.migrated.extensions, 0);

    // Cookies are returned for CDP seeding, not written to disk.
    assert.equal(report.cookies[0].domain, '.example.com');

    const row = new BetterSqlite3(path.join(target, 'Login Data'), {
      readonly: true,
    })
      .prepare('SELECT password_value FROM logins')
      .get();
    assert.equal(
      decryptChromiumCookie({
        encryptedValue: row.password_value,
        host: 'a.example',
        databaseVersion: 0,
        platform: 'linux',
        key: targetKey,
      }),
      'pw'
    );
  });

  it('honours the include filter', async () => {
    const source = await makeTempDir();
    const target = await makeTempDir();
    writePlaces(source);
    writeCookies(source, [{ name: 'a', value: '1', host: '.example.com' }]);

    const report = await migrateProfile({
      from: { browser: 'firefox', userDataDir: source },
      to: target,
      include: ['bookmarks'],
      platform: 'linux',
    });
    assert.equal(report.migrated.bookmarks, 1);
    assert.equal(report.migrated.cookies, 0);
    await assert.rejects(() => readFile(path.join(target, 'Login Data')));
  });

  it('skips passwords with a warning when no target key is available on Windows', async () => {
    const source = await makeTempDir();
    const target = await makeTempDir();
    writePlaces(source);

    const report = await migrateProfile({
      from: { browser: 'firefox', userDataDir: source },
      to: target,
      include: ['passwords'],
      platform: 'win32',
    });
    assert.equal(report.migrated.passwords, 0);
    assert.ok(
      report.skipped.some(
        (s) => s.type === 'passwords' && s.reason === 'target-key-unavailable'
      )
    );
    assert.equal(report.warnings[0].reason, 'target-key-unavailable');
  });
});
