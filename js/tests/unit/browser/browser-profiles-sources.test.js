import assert from 'node:assert';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  listBrowserProfiles,
  resolveBrowserProfile,
  resolveSourceBrowser,
} from '../../../src/browser/browser-profiles.js';
import { writeFirefoxProfile } from '../../helpers/migration-fixtures.js';
import { useTempDirectories } from '../../helpers/temp-directory.js';

const makeDirectory = useTempDirectories();

/** The browser of every profile `listBrowserProfiles` finds. */
async function listedBrowsers(options) {
  const profiles = await listBrowserProfiles(options);
  return profiles.map((profile) => profile.browser);
}

async function writeChromiumCookieDatabase(profilePath) {
  const cookiePath = path.join(profilePath, 'Network', 'Cookies');
  await mkdir(path.dirname(cookiePath), { recursive: true });
  await writeFile(cookiePath, 'SQLite format 3\u0000');
  return cookiePath;
}

describe('listBrowserProfiles with the expanded catalogue', () => {
  it('reads an Opera single-profile layout from the root itself', async () => {
    const temporaryDirectory = await makeDirectory('bc-opera-');
    const root = path.join(temporaryDirectory, '.config', 'opera');
    await mkdir(root, { recursive: true });
    const cookiePath = await writeChromiumCookieDatabase(root);

    const profiles = await listBrowserProfiles({
      browser: 'opera',
      platform: 'linux',
      homeDir: temporaryDirectory,
      environment: {},
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
    const temporaryDirectory = await makeDirectory('bc-librewolf-');
    const profilePath = await writeFirefoxProfile(
      temporaryDirectory,
      [{ name: 'a', value: '1', host: '.example.com' }],
      { root: '.librewolf', name: 'default' }
    );

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
    const temporaryDirectory = await makeDirectory('bc-ffshare-');
    await writeFirefoxProfile(temporaryDirectory, [
      { name: 'a', value: '1', host: '.example.com' },
    ]);

    assert.deepEqual(
      await listedBrowsers({ platform: 'linux', homeDir: temporaryDirectory }),
      ['firefox']
    );
  });

  it('resolves browser: "default" to the system default browser', async () => {
    const runCommand = async (command, args) => {
      if (
        command === 'xdg-settings' &&
        args.join(' ') === 'get default-web-browser'
      ) {
        return 'firefox.desktop\n';
      }
      throw new Error('unexpected command');
    };
    assert.equal(
      await resolveSourceBrowser('default', { platform: 'linux', runCommand }),
      'firefox'
    );
    assert.equal(
      await resolveSourceBrowser('AUTO', { platform: 'linux', runCommand }),
      'firefox'
    );
  });

  it('lists the default browser profile when browser is "default"', async () => {
    const temporaryDirectory = await makeDirectory('bc-default-');
    const profilePath = await writeFirefoxProfile(temporaryDirectory, [
      { name: 'a', value: '1', host: '.example.com' },
    ]);
    const runCommand = async () => 'firefox.desktop\n';

    const resolved = await resolveBrowserProfile({
      browser: 'default',
      platform: 'linux',
      homeDir: temporaryDirectory,
      runCommand,
    });
    assert.equal(resolved.browser, 'firefox');
    assert.equal(resolved.path, profilePath);

    assert.deepEqual(
      await listedBrowsers({
        browser: 'auto',
        platform: 'linux',
        homeDir: temporaryDirectory,
        runCommand,
      }),
      ['firefox']
    );
  });

  it('reports a clear error when the default browser is unknown', async () => {
    await assert.rejects(
      resolveSourceBrowser('default', {
        platform: 'linux',
        runCommand: async () => {
          throw new Error('no xdg');
        },
      }),
      /Could not determine the system default browser/
    );
  });
});
