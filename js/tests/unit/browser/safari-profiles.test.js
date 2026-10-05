import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { it } from 'node:test';
import Database from 'better-sqlite3';
import { listBrowserProfiles } from '../../../src/browser/browser-profiles.js';
import { listCookieSources } from '../../../src/browser/browser-cookies.js';
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

it('preserves a Safari catalogue error while listing its readable cookies and other browsers', async () => {
  const homeDir = await temporary();
  const root = path.join(
    homeDir,
    'Library/Containers/com.apple.Safari/Data/Library'
  );
  await mkdir(path.join(root, 'Safari'), { recursive: true });
  await mkdir(path.join(root, 'Cookies'));
  await copyFile(
    repoPath('tests/fixtures/safari/Cookies.binarycookies'),
    path.join(root, 'Cookies/Cookies.binarycookies')
  );
  const tabs = path.join(root, 'Safari/SafariTabs.db');
  new Database(tabs).close();
  const chromium = path.join(
    homeDir,
    'Library/Application Support/Google/Chrome/Default'
  );
  await mkdir(chromium, { recursive: true });
  const db = new Database(path.join(chromium, 'Cookies'));
  db.exec(
    "CREATE TABLE cookies(host_key TEXT); INSERT INTO cookies VALUES ('.github.com')"
  );
  db.close();
  const before = await readFile(tabs);
  const options = { platform: 'darwin', homeDir, environment: {} };
  const profiles = await listBrowserProfiles(options);
  assert.equal(
    profiles.filter(({ browser }) => browser === 'safari').length,
    2
  );
  const sources = await listCookieSources({
    ...options,
    domains: ['github.com'],
  });
  assert.equal(sources.find(({ browser }) => browser === 'chrome').cookies, 1);
  assert.equal(
    sources.find(({ browser, error }) => browser === 'safari' && !error)
      .cookies,
    4
  );
  assert.match(
    sources.find(({ browser, error }) => browser === 'safari' && error).error,
    /no such table/u
  );
  assert.deepEqual(await readFile(tabs), before);
});
