import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BROWSER_SOURCES,
  resolveBrowserRoots,
} from '../../../src/browser/browser-sources.js';
import {
  assertDedicatedUserDataDir,
  CHANNEL_EXECUTABLE_NAMES,
} from '../../../src/browser/system-browser.js';

describe('catalogue launch and protection (#121)', () => {
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
