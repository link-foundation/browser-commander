import assert from 'node:assert';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  migrateFirefoxBookmarks,
  migrateFirefoxPasswords,
  readFirefoxCookies,
  reportFirefoxHistory,
} from '../../../../src/browser/migration/firefox.js';
import { deriveChromiumCookieKey } from '../../../../src/browser/browser-cookie-crypto.js';
import {
  assertNothingMigrated,
  readMigratedLogins,
  readProfileJson,
  writeFirefoxCookies,
  writeFirefoxLogins,
  writeFirefoxPlaces,
} from '../../../helpers/migration-fixtures.js';
import { useTempDirectories } from '../../../helpers/temp-directory.js';

const makeTempDir = useTempDirectories('bc-ff-');

describe('readFirefoxCookies', () => {
  it('reads and maps cookies, applying the domain filter', async () => {
    const dir = await makeTempDir();
    await writeFirefoxCookies(dir, [
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
    writeFirefoxPlaces(source);
    const report = await migrateFirefoxBookmarks({
      profileDir: source,
      targetProfileDir: target,
    });
    assert.equal(report.migrated, 2);
    const doc = await readProfileJson(target, 'Bookmarks');
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
    writeFirefoxPlaces(source);
    const report = await reportFirefoxHistory({ profileDir: source });
    assertNothingMigrated(report, 'firefox-history-schema-incompatible');
    assert.match(report.warnings[0].detail, /2 history entries/);
  });
});

describe('migrateFirefoxPasswords', () => {
  it('decrypts logins and re-encrypts them into a Chrome Login Data', async () => {
    const source = await makeTempDir();
    const target = await makeTempDir();
    const { key4Path } = await writeFirefoxLogins(source, {
      entries: [
        {
          hostname: 'https://a.example',
          username: 'alice',
          password: 'secret-A',
        },
      ],
    });
    assert.equal(key4Path, path.join(source, 'key4.db'));

    const targetKey = deriveChromiumCookieKey('target-pass', 'linux');
    const report = await migrateFirefoxPasswords({
      profileDir: source,
      targetProfileDir: target,
      platform: 'linux',
      targetKey,
      targetPrefix: 'v11',
    });
    assert.equal(report.migrated, 1);

    const [login] = readMigratedLogins(target, targetKey);
    assert.equal(login.username, 'alice');
    assert.equal(login.password, 'secret-A');
  });

  // Each case leaves the source unable to yield passwords in a different way.
  for (const { title, reason, writeSource } of [
    {
      title: 'reports primary-password-set when the key is locked',
      reason: 'primary-password-set',
      writeSource: (source) =>
        writeFirefoxLogins(source, {
          primaryPassword: Buffer.from('locked'),
          entries: [
            { hostname: 'https://a.example', username: 'a', password: 'b' },
          ],
        }),
    },
    {
      title: 'reports source-missing when there is no logins.json',
      reason: 'source-missing',
      writeSource: async () => {},
    },
  ]) {
    it(title, async () => {
      const source = await makeTempDir();
      const target = await makeTempDir();
      await writeSource(source);
      const report = await migrateFirefoxPasswords({
        profileDir: source,
        targetProfileDir: target,
        platform: 'linux',
        targetKey: deriveChromiumCookieKey('t', 'linux'),
      });
      assertNothingMigrated(report, reason);
    });
  }
});
