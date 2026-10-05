import assert from 'node:assert';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { listBrowserProfiles } from '../../../src/browser/browser-profiles.js';
import { writeFirefoxCookies } from '../../helpers/migration-fixtures.js';

let temporaryDirectory;

afterEach(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

async function writeChromiumCookieDatabase(profilePath) {
  const cookiePath = path.join(profilePath, 'Network', 'Cookies');
  await mkdir(path.dirname(cookiePath), { recursive: true });
  await writeFile(cookiePath, 'SQLite format 3\u0000');
  return cookiePath;
}

describe('listBrowserProfiles with the expanded catalogue', () => {
  it('reads an Opera single-profile layout from the root itself', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'bc-opera-'));
    const root = path.join(temporaryDirectory, '.config', 'opera');
    await mkdir(root, { recursive: true });
    const cookiePath = await writeChromiumCookieDatabase(root);

    const profiles = await listBrowserProfiles({
      browser: 'opera',
      platform: 'linux',
      homeDir: temporaryDirectory,
    });

    assert.deepEqual(profiles, [
      {
        browser: 'opera',
        name: 'Default',
        displayName: 'Default',
        path: root,
        isDefault: true,
      },
    ]);
    assert.ok(cookiePath.startsWith(root));
  });

  it('discovers a Firefox fork (LibreWolf) by its own root', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'bc-librewolf-'));
    const root = path.join(temporaryDirectory, '.librewolf');
    const profileName = 'abcd.default';
    const profilePath = path.join(root, profileName);
    await mkdir(profilePath, { recursive: true });
    await writeFile(
      path.join(root, 'profiles.ini'),
      `[Profile0]\nName=default\nIsRelative=1\nPath=${profileName}\nDefault=1\n`
    );
    await writeFirefoxCookies(profilePath, [
      { name: 'a', value: '1', host: '.example.com' },
    ]);

    const profiles = await listBrowserProfiles({
      browser: 'librewolf',
      platform: 'linux',
      homeDir: temporaryDirectory,
    });

    assert.deepEqual(profiles, [
      {
        browser: 'librewolf',
        name: 'default',
        displayName: 'default',
        path: profilePath,
        isDefault: true,
      },
    ]);
  });

  it('lists Firefox once when its channels share a root', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'bc-ffshare-'));
    const root = path.join(temporaryDirectory, '.mozilla', 'firefox');
    const profileName = 'xyz.default-release';
    const profilePath = path.join(root, profileName);
    await mkdir(profilePath, { recursive: true });
    await writeFile(
      path.join(root, 'profiles.ini'),
      `[Profile0]\nName=default-release\nIsRelative=1\nPath=${profileName}\nDefault=1\n`
    );
    await writeFirefoxCookies(profilePath, [
      { name: 'a', value: '1', host: '.example.com' },
    ]);

    const profiles = await listBrowserProfiles({
      platform: 'linux',
      homeDir: temporaryDirectory,
    });

    assert.deepEqual(
      profiles.map((profile) => profile.browser),
      ['firefox']
    );
  });
});
