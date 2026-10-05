import assert from 'node:assert';
import { describe, it } from 'node:test';

import {
  BROWSER_IDS,
  browserFamily,
  defaultBrowserIdentifiers,
  findBrowserSource,
  isSingleProfileBrowser,
  normalizeBrowserId,
  resolveBrowserRoots,
  safeStorageIdentity,
} from '../../../src/browser/browser-sources.js';

describe('browser-sources catalogue', () => {
  it('keeps the original five browsers resolvable by id and alias', () => {
    assert.equal(normalizeBrowserId('chrome'), 'chrome');
    assert.equal(normalizeBrowserId('msedge'), 'edge');
    assert.equal(normalizeBrowserId('microsoft-edge'), 'edge');
    assert.equal(normalizeBrowserId('google-chrome'), 'chrome');
    assert.equal(normalizeBrowserId('CHROME'), 'chrome');
  });

  it('adds the new source browsers from #114', () => {
    for (const id of [
      'opera',
      'opera-gx',
      'vivaldi',
      'arc',
      'yandex',
      'chrome-beta',
      'chrome-dev',
      'chrome-canary',
      'edge-beta',
      'edge-dev',
      'librewolf',
      'waterfox',
      'zen',
      'floorp',
      'firefox-developer',
      'firefox-nightly',
    ]) {
      assert.ok(BROWSER_IDS.includes(id), `missing ${id}`);
      assert.ok(findBrowserSource(id), `unresolvable ${id}`);
    }
  });

  it('rejects an unknown browser with the catalogue listed', () => {
    assert.throws(
      () => normalizeBrowserId('netscape'),
      /Unsupported browser: netscape\. Expected one of .*chrome/
    );
  });

  it('classifies browser families', () => {
    assert.equal(browserFamily('chrome'), 'chromium');
    assert.equal(browserFamily('opera'), 'chromium');
    assert.equal(browserFamily('firefox'), 'firefox');
    assert.equal(browserFamily('librewolf'), 'firefox');
  });

  it('expands per-platform roots with the home directory', () => {
    assert.deepEqual(
      resolveBrowserRoots('chrome', { platform: 'linux', homeDir: '/home/me' }),
      ['/home/me/.config/google-chrome']
    );
    assert.deepEqual(
      resolveBrowserRoots('firefox', {
        platform: 'darwin',
        homeDir: '/Users/me',
      }),
      ['/Users/me/Library/Application Support/Firefox']
    );
  });

  it('honours XDG_CONFIG_HOME on Linux', () => {
    assert.deepEqual(
      resolveBrowserRoots('chromium', {
        platform: 'linux',
        homeDir: '/home/me',
        environment: { XDG_CONFIG_HOME: '/cfg' },
      }),
      ['/cfg/chromium']
    );
  });

  it('builds Windows roots with backslashes from %APPDATA%/%LOCALAPPDATA%', () => {
    assert.deepEqual(
      resolveBrowserRoots('opera', {
        platform: 'win32',
        homeDir: 'C:\\Users\\me',
        environment: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' },
      }),
      ['C:\\Users\\me\\AppData\\Roaming\\Opera Software\\Opera Stable']
    );
    assert.deepEqual(
      resolveBrowserRoots('chrome', {
        platform: 'win32',
        homeDir: 'C:\\Users\\me',
        environment: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
      }),
      ['C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\User Data']
    );
  });

  it('returns no root where a browser does not run', () => {
    assert.deepEqual(
      resolveBrowserRoots('chrome-canary', {
        platform: 'linux',
        homeDir: '/home/me',
      }),
      []
    );
    assert.deepEqual(
      resolveBrowserRoots('arc', { platform: 'linux', homeDir: '/home/me' }),
      []
    );
  });

  it('marks Opera-style browsers as single-profile', () => {
    assert.equal(isSingleProfileBrowser('opera'), true);
    assert.equal(isSingleProfileBrowser('opera-gx'), true);
    assert.equal(isSingleProfileBrowser('chrome'), false);
    assert.equal(isSingleProfileBrowser('vivaldi'), false);
  });

  it('exposes a Safe Storage identity for Chromium and none for Firefox', () => {
    assert.deepEqual(safeStorageIdentity('brave'), {
      service: 'Brave Safe Storage',
      application: 'brave',
      folder: 'Brave Keys',
    });
    assert.equal(safeStorageIdentity('firefox'), undefined);
  });

  it('exposes default-browser identifiers per platform', () => {
    assert.deepEqual(defaultBrowserIdentifiers('chrome', 'darwin'), [
      'com.google.chrome',
    ]);
    assert.deepEqual(defaultBrowserIdentifiers('firefox', 'win32'), [
      'FirefoxHTML',
      'FirefoxURL',
    ]);
    assert.deepEqual(defaultBrowserIdentifiers('chrome', 'nope'), []);
  });
});
