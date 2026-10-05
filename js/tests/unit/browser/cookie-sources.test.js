// feature-parity: sources.cookie-listing@native-typed
import assert from 'node:assert';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { listCookieSources } from '../../../src/browser/browser-cookies.js';
import { writeFirefoxCookies } from '../../helpers/migration-fixtures.js';

let temporaryDirectory;

afterEach(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

async function makeFirefoxProfile(home, cookies) {
  const root = path.join(home, '.mozilla', 'firefox');
  const profileName = 'xyz.default-release';
  const profilePath = path.join(root, profileName);
  await mkdir(profilePath, { recursive: true });
  await writeFile(
    path.join(root, 'profiles.ini'),
    `[Profile0]\nName=default-release\nIsRelative=1\nPath=${profileName}\nDefault=1\n`
  );
  await writeFirefoxCookies(profilePath, cookies);
  return profilePath;
}

describe('listCookieSources', () => {
  it('reports cookie counts per profile without reading values', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'bc-src-'));
    const profilePath = await makeFirefoxProfile(temporaryDirectory, [
      { name: 'a', value: 'secret-1', host: '.example.com' },
      { name: 'b', value: 'secret-2', host: '.example.com' },
      { name: 'c', value: 'secret-3', host: '.other.test' },
    ]);

    const sources = await listCookieSources({
      platform: 'linux',
      homeDir: temporaryDirectory,
    });

    assert.equal(sources.length, 1);
    const [source] = sources;
    assert.equal(source.browser, 'firefox');
    assert.equal(source.path, profilePath);
    assert.equal(source.cookies, 3);
    assert.equal(source.byDomain, null);
    // Never expose a value anywhere in the payload.
    assert.ok(!JSON.stringify(sources).includes('secret-'));
  });

  it('counts per domain and omits profiles that hold none', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'bc-src2-'));
    await makeFirefoxProfile(temporaryDirectory, [
      { name: 'a', value: '1', host: '.example.com' },
      { name: 'b', value: '2', host: '.example.com' },
    ]);

    const matched = await listCookieSources({
      domains: ['example.com'],
      platform: 'linux',
      homeDir: temporaryDirectory,
    });
    assert.equal(matched.length, 1);
    assert.deepEqual(matched[0].byDomain, { 'example.com': 2 });

    const none = await listCookieSources({
      domains: ['absent.test'],
      platform: 'linux',
      homeDir: temporaryDirectory,
    });
    assert.deepEqual(none, []);
  });
});
