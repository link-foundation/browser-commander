import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  ALL_DATA_CLASSES,
  migrateProfile,
} from '../../../../src/browser/migration/index.js';
import { deriveChromiumCookieKey } from '../../../../src/browser/browser-cookie-crypto.js';
import {
  readMigratedLogins,
  writeFirefoxCookies,
  writeFirefoxLogins,
  writeFirefoxPlaces,
} from '../../../helpers/migration-fixtures.js';
import { useTempDirectories } from '../../../helpers/temp-directory.js';

const makeTempDir = useTempDirectories('bc-orch-');

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
    await writeFirefoxCookies(source, [
      { name: 'a', value: '1', host: '.example.com' },
    ]);
    writeFirefoxPlaces(source, { withMenuBookmark: false });
    await writeFirefoxLogins(source, {
      entries: [
        { hostname: 'https://a.example', username: 'alice', password: 'pw' },
      ],
    });

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

    assert.equal(readMigratedLogins(target, targetKey)[0].password, 'pw');
  });

  it('honours the include filter', async () => {
    const source = await makeTempDir();
    const target = await makeTempDir();
    writeFirefoxPlaces(source, { withMenuBookmark: false });
    await writeFirefoxCookies(source, [
      { name: 'a', value: '1', host: '.example.com' },
    ]);

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
    writeFirefoxPlaces(source, { withMenuBookmark: false });

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
