import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';

import { openSqliteDatabase } from '../../../src/browser/browser-cookie-database.js';
import { readBrowserCookiesWithDependencies } from '../../../src/browser/browser-cookies.js';
import { migrateProfile } from '../../../src/browser/migration/index.js';

const fixture = await readFile(
  new URL(
    '../../../../tests/fixtures/firefox-cookie-expiry.sql',
    import.meta.url
  ),
  'utf8'
);

for (const version of [0, 15, 16, 17]) {
  for (const migration of [false, true]) {
    it(`normalizes Firefox schema ${version} expiry through ${migration ? 'migration' : 'installed reading'}`, async () => {
      const homeDir = await mkdtemp(path.join(os.tmpdir(), 'bc-ff-expiry-'));
      try {
        const root = path.join(homeDir, '.mozilla', 'firefox');
        const source = path.join(root, 'expiry.default-release');
        await mkdir(source, { recursive: true });
        await writeFile(
          path.join(root, 'profiles.ini'),
          '[Profile0]\nName=default-release\nIsRelative=1\nPath=expiry.default-release\nDefault=1\n'
        );
        const file = path.join(source, 'cookies.sqlite');
        const database = await openSqliteDatabase(file);
        try {
          database.exec(fixture);
          database.exec(`PRAGMA user_version = ${version}`);
          if (version >= 16) {
            database.exec(
              'UPDATE moz_cookies SET expiry = expiry * 1000 + 999 WHERE expiry > 0'
            );
          }
        } finally {
          database.close();
        }
        const before = await readFile(file);
        const options = { platform: 'linux', homeDir, environment: {} };
        const cookies = migration
          ? (
              await migrateProfile({
                from: { browser: 'firefox', userDataDir: source },
                to: path.join(homeDir, 'target'),
                include: ['cookies'],
                domains: ['expiry.example'],
                ...options,
              })
            ).cookies
          : await readBrowserCookiesWithDependencies(
              {
                browser: 'firefox',
                domainFilter: 'expiry.example',
                cache: false,
              },
              options
            );
        assert.equal(cookies.length, 3);
        const expiry = Object.fromEntries(
          cookies.map((cookie) => [cookie.name, cookie.expires])
        );
        assert.deepEqual(expiry, {
          persistent: 2_000_000_001,
          'session-negative': -1,
          'session-zero': -1,
        });
        assert.deepEqual(await readFile(file), before);
      } finally {
        await rm(homeDir, { recursive: true, force: true });
      }
    });
  }
}
