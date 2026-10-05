import assert from 'node:assert/strict';
import { readFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  readSafariBookmarks,
  readSafariHistory,
  readSafariPasswords,
} from '../../../../src/browser/migration/safari.js';
import { migrateProfile } from '../../../../src/browser/migration/index.js';
import { useTempDirectories } from '../../../helpers/temp-directory.js';
import Database from 'better-sqlite3';
import path from 'node:path';
import {
  deriveChromiumCookieKey,
  decryptChromiumCookie,
} from '../../../../src/browser/browser-cookie-crypto.js';

const fixture = (name) =>
  fileURLToPath(
    new URL(
      `../../../../../tests/fixtures/safari-data/${name}`,
      import.meta.url
    )
  );

describe('Safari data sources', () => {
  for (const format of ['binary', 'xml']) {
    it(`preserves hierarchy and reading list from ${format} plist`, async () => {
      const filename = fixture(`Bookmarks-${format}.plist`);
      const before = await readFile(filename);
      const tree = await readSafariBookmarks(filename);
      assert.equal(tree[0].name, 'Work');
      assert.equal(tree[0].children[0].name, 'Foundation ☃');
      assert.equal(tree[1].children[0].readingList, true);
      assert.deepEqual(await readFile(filename), before);
    });
  }

  it('preserves all matching visits and converts the Cocoa epoch', async () => {
    const filename = fixture('History.db');
    const before = await readFile(filename);
    const entries = await readSafariHistory(filename, ['github.com']);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].time, 1778307200250000);
    assert.deepEqual(await readFile(filename), before);
  });

  it('reads explicit BOM UTF-8 CSV with quoted newlines and filters domains', async () => {
    const entries = await readSafariPasswords(fixture('Passwords.csv'), [
      'github.com',
    ]);
    assert.deepEqual(entries, [
      {
        origin: 'https://github.com/login',
        username: 'a,b',
        password: 'p"a\nss',
      },
    ]);
  });

  const temporary = useTempDirectories('bc-safari-data-');
  it('migrates custom Safari sources into native Chromium stores with target encryption', async () => {
    const source = await temporary();
    const target = await temporary();
    await copyFile(
      fixture('Bookmarks-binary.plist'),
      path.join(source, 'Bookmarks.plist')
    );
    await copyFile(fixture('History.db'), path.join(source, 'History.db'));
    const key = deriveChromiumCookieKey('dedicated-target', 'linux');
    const report = await migrateProfile({
      from: { browser: 'safari', userDataDir: source },
      to: target,
      include: ['bookmarks', 'history', 'passwords'],
      domains: ['github.com'],
      passwordCsv: fixture('Passwords.csv'),
      platform: 'linux',
      keys: { targetKey: key, targetPrefix: 'v11' },
    });
    assert.equal(report.migrated.bookmarks, 2);
    assert.equal(report.migrated.history, 2);
    assert.equal(report.migrated.passwords, 1);
    assert.deepEqual(report.skipped, []);
    assert.ok(
      report.warnings.some(
        ({ reason }) => reason === 'safari-reading-list-translated'
      )
    );
    const db = new Database(path.join(target, 'Login Data'));
    try {
      const rows = db
        .prepare('SELECT origin_url,password_value FROM logins')
        .all();
      assert.equal(rows.length, 1);
      assert.equal(
        decryptChromiumCookie({
          encryptedValue: rows[0].password_value,
          key,
          platform: 'linux',
          databaseVersion: 0,
          host: 'github.com',
        }),
        'p"a\nss'
      );
    } finally {
      db.close();
    }
  });

  it('names the executing app and retry link for non-cookie protection failures', async () => {
    const { withSafariAccess } =
      await import('../../../../src/browser/safari-access.js');
    for (const code of ['EPERM', 'EACCES']) {
      await assert.rejects(
        withSafariAccess(
          '/Safari/History.db',
          () => {
            throw Object.assign(new Error('protected'), { code });
          },
          { TERM_PROGRAM: 'FixtureTerminal' }
        ),
        /Full Disk Access to FixtureTerminal.*Privacy_AllFiles/u
      );
    }
  });
});
