// feature-parity: sources.cookie-listing@native-typed
import assert from 'node:assert';
import { describe, it } from 'node:test';

import {
  listCookieSources,
  resolveImportSource,
} from '../../../src/browser/browser-cookies.js';
import { writeFirefoxProfile } from '../../helpers/migration-fixtures.js';
import { useTempDirectories } from '../../helpers/temp-directory.js';

const makeDirectory = useTempDirectories();

describe('listCookieSources', () => {
  it('reports cookie counts per profile without reading values', async () => {
    const temporaryDirectory = await makeDirectory('bc-src-');
    const profilePath = await writeFirefoxProfile(temporaryDirectory, [
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
    const temporaryDirectory = await makeDirectory('bc-src2-');
    await writeFirefoxProfile(temporaryDirectory, [
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

describe('resolveImportSource', () => {
  // feature-parity: sources.default-domain-fallback@native-typed
  const firefoxIsDefault = async () => 'firefox.desktop\n';
  const githubCookie = [{ name: 'a', value: '1', host: '.github.com' }];
  const otherCookie = [{ name: 'b', value: '2', host: '.other.test' }];

  async function resolve(homeDir, overrides = {}) {
    return await resolveImportSource({
      browser: 'default',
      domains: ['github.com'],
      platform: 'linux',
      homeDir,
      environment: {},
      runCommand: firefoxIsDefault,
      ...overrides,
    });
  }

  it('keeps the system default when it holds the domains', async () => {
    const homeDir = await makeDirectory('bc-import-default-');
    await writeFirefoxProfile(homeDir, githubCookie);
    await writeFirefoxProfile(homeDir, githubCookie, {
      root: '.librewolf',
      name: 'default',
    });

    assert.deepEqual(await resolve(homeDir), {
      browser: 'firefox',
      profile: 'default-release',
      warning: null,
    });
  });

  it('falls back to the installed browser that holds the domains', async () => {
    const homeDir = await makeDirectory('bc-import-fallback-');
    await writeFirefoxProfile(homeDir, otherCookie);
    await writeFirefoxProfile(homeDir, githubCookie, {
      root: '.librewolf',
      name: 'default',
    });

    const source = await resolve(homeDir);
    assert.equal(source.browser, 'librewolf');
    assert.equal(source.profile, 'default');
    assert.equal(source.warning.reason, 'default-browser-fallback');
    assert.equal(source.warning.item, 'librewolf');
    assert.match(
      source.warning.detail,
      /default browser \(firefox\) holds no cookies for github\.com; imported from librewolf/
    );
  });

  it('falls back when the system default cannot be determined', async () => {
    const homeDir = await makeDirectory('bc-import-unknown-');
    await writeFirefoxProfile(homeDir, githubCookie, {
      root: '.librewolf',
      name: 'default',
    });
    const runCommand = async () => {
      throw new Error('no xdg');
    };

    const source = await resolve(homeDir, { runCommand });
    assert.equal(source.browser, 'librewolf');
    assert.equal(source.warning.reason, 'default-browser-unknown');
    await assert.rejects(
      resolve(await makeDirectory('bc-import-none-'), { runCommand }),
      /no installed browser holds cookies for github\.com/
    );
  });

  it('resolves the default plainly without domains', async () => {
    const homeDir = await makeDirectory('bc-import-plain-');
    assert.deepEqual(await resolve(homeDir, { domains: undefined }), {
      browser: 'firefox',
      profile: undefined,
      warning: null,
    });
    assert.deepEqual(await resolve(homeDir, { browser: 'Opera' }), {
      browser: 'opera',
      profile: undefined,
      warning: null,
    });
  });
});
