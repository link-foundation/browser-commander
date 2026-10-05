// feature-parity: migration.profile@native-typed
import assert from 'node:assert';
import { mkdir, readFile } from 'node:fs/promises';
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
  writeFirefoxProfile,
  writeProfileJson,
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

  it('imports a domain from whichever installed browser holds it', async () => {
    const homeDir = await makeTempDir();
    const target = await makeTempDir();
    await writeFirefoxProfile(homeDir, [
      { name: 'a', value: '1', host: '.other.test' },
    ]);
    await writeFirefoxProfile(
      homeDir,
      [{ name: 'session', value: 's', host: '.github.com' }],
      { root: '.librewolf', name: 'default' }
    );

    const report = await migrateProfile({
      from: { browser: 'default' },
      to: target,
      include: ['cookies'],
      domains: ['github.com'],
      platform: 'linux',
      homeDir,
      environment: {},
      runCommand: async () => 'firefox.desktop\n',
    });

    assert.equal(report.source.browser, 'librewolf');
    assert.equal(report.source.profile, 'default');
    assert.equal(report.migrated.cookies, 1);
    assert.deepEqual(
      report.warnings.map(({ reason }) => reason),
      ['default-browser-fallback']
    );
  });

  it('reads a single-profile Chromium browser (Opera) from its root', async () => {
    const homeDir = await makeTempDir();
    const target = await makeTempDir();
    const root = path.join(homeDir, '.config', 'opera');
    await mkdir(root, { recursive: true });
    await writeProfileJson(root, 'Bookmarks', {
      roots: {
        bookmark_bar: {
          type: 'folder',
          children: [{ type: 'url', name: 'A', url: 'https://a.example/' }],
        },
      },
    });

    const report = await migrateProfile({
      from: { browser: 'opera' },
      to: target,
      include: ['bookmarks'],
      platform: 'linux',
      homeDir,
      environment: {},
    });

    assert.equal(report.migrated.bookmarks, 1);
    assert.deepEqual(report.skipped, []);
  });
});
