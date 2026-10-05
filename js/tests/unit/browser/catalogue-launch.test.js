import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import { useTempDirectories } from '../../helpers/temp-directory.js';
import {
  BROWSER_SOURCES,
  resolveBrowserRoots,
} from '../../../src/browser/browser-sources.js';
import {
  assertDedicatedUserDataDir,
  CHANNEL_EXECUTABLE_NAMES,
} from '../../../src/browser/system-browser.js';

const temporary = useTempDirectories('bc-catalogue-protection-');

describe('catalogue launch and protection (#121)', () => {
  it('protects a new profile beneath a symlink to a default root', async () => {
    const homeDir = await temporary();
    const options = { homeDir, environment: {} };
    const root = resolveBrowserRoots('chrome', options)[0];
    await mkdir(root, { recursive: true });
    const alias = path.join(homeDir, 'profile-alias');
    await symlink(
      root,
      alias,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    assert.throws(
      () =>
        assertDedicatedUserDataDir(path.join(alias, 'new-profile'), options),
      /dedicated.*default profile/
    );
  });

  it('offers launch names for every supported Chromium source and alias', () => {
    for (const browser of BROWSER_SOURCES.filter(
      (entry) => entry.family === 'chromium'
    )) {
      assert.ok(CHANNEL_EXECUTABLE_NAMES[browser.id]?.length, browser.id);
      for (const alias of browser.aliases ?? []) {
        assert.deepEqual(
          CHANNEL_EXECUTABLE_NAMES[alias],
          CHANNEL_EXECUTABLE_NAMES[browser.id]
        );
      }
    }
  });

  it('protects every catalogue root and descendant profile on every OS', () => {
    for (const platform of ['linux', 'darwin', 'win32']) {
      const options = {
        platform,
        homeDir: platform === 'win32' ? 'C:\\Users\\test' : '/users/test',
        environment: {},
      };
      for (const browser of BROWSER_SOURCES) {
        for (const root of resolveBrowserRoots(browser.id, options)) {
          assert.throws(
            () => assertDedicatedUserDataDir(root, options),
            /dedicated.*default profile/,
            `${browser.id}: ${root}`
          );
          assert.throws(
            () =>
              assertDedicatedUserDataDir(
                `${root}${platform === 'win32' ? '\\' : '/'}Profile 1`,
                options
              ),
            /dedicated.*default profile/
          );
        }
      }
    }
  });

  it('adds the requested desktop catalogue entries', () => {
    for (const id of [
      'whale',
      '360se',
      '360chrome',
      'qq',
      'sogou',
      'duckduckgo',
      'tor',
    ]) {
      assert.ok(
        BROWSER_SOURCES.some((entry) => entry.id === id),
        id
      );
    }
  });
});
