import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { it } from 'node:test';
import Database from 'better-sqlite3';
import { listBrowserProfiles } from '../../../src/browser/browser-profiles.js';
import { findSafariCookieFile } from '../../../src/browser/safari-cookies.js';
import { repoPath } from '../../helpers/repo.js';
import { useTempDirectories } from '../../helpers/temp-directory.js';

const temporary = useTempDirectories('bc-safari-stores-');
const uuid = '11111111-2222-3333-4444-555555555555';

it('discovers Safari named profiles and prefers WebKit stores to stale legacy cookies', async () => {
  const homeDir = await temporary();
  const root = path.join(
    homeDir,
    'Library/Containers/com.apple.Safari/Data/Library'
  );
  const named = path.join(root, 'Safari/Profiles', uuid);
  await mkdir(named, { recursive: true });
  const db = new Database(path.join(root, 'Safari/SafariTabs.db'));
  db.exec(
    await readFile(
      repoPath('tests/fixtures/safari-data/SafariTabs.sql'),
      'utf8'
    )
  );
  db.close();
  const locations = [
    'Cookies',
    'WebKit/WebsiteData/Default/Cookies',
    `WebKit/WebsiteDataStore/${uuid}/Cookies`,
  ];
  for (const location of locations) {
    await mkdir(path.join(root, location), { recursive: true });
    await copyFile(
      repoPath('tests/fixtures/safari/Cookies.binarycookies'),
      path.join(root, location, 'Cookies.binarycookies')
    );
  }
  const profiles = await listBrowserProfiles({
    browser: 'safari',
    platform: 'darwin',
    homeDir,
    environment: {},
  });
  assert.deepEqual(
    profiles.map(({ name }) => name),
    ['Default', uuid]
  );
  assert.equal(profiles[1].displayName, 'Work');
  assert.equal(profiles[1].path, named);
  assert.equal(
    await findSafariCookieFile(root),
    path.join(root, locations[1], 'Cookies.binarycookies')
  );
  assert.equal(
    await findSafariCookieFile(named),
    path.join(root, locations[2], 'Cookies.binarycookies')
  );
});
