import assert from 'node:assert';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { readBrowserCookiesWithDependencies } from '../../../src/browser/browser-cookies.js';
import { writeFirefoxCookies } from '../../helpers/migration-fixtures.js';

let temporaryDirectory;

afterEach(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

describe('readBrowserCookies honours an explicit profileDir', () => {
  it('reads cookies from the given directory, not the default profile root', async () => {
    temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'bc-profiledir-')
    );
    // A custom userDataDir that is NOT under the default profile root.
    const customProfile = path.join(temporaryDirectory, 'custom', 'profile');
    await mkdir(customProfile, { recursive: true });
    await writeFirefoxCookies(customProfile, [
      { name: 'sid', value: 'abc', host: '.example.com' },
    ]);

    // homeDir points somewhere with no browser data, so a reader that ignored
    // profileDir and re-resolved the default profile would find nothing.
    const emptyHome = path.join(temporaryDirectory, 'empty-home');
    await mkdir(emptyHome, { recursive: true });

    const cookies = await readBrowserCookiesWithDependencies(
      { browser: 'firefox', profileDir: customProfile },
      { platform: 'linux', homeDir: emptyHome }
    );

    assert.equal(cookies.length, 1);
    assert.equal(cookies[0].name, 'sid');
    assert.equal(cookies[0].domain, '.example.com');
  });
});
