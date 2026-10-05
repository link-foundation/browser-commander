// feature-parity: sources.cookie-listing@native-typed
import assert from 'node:assert';
import { describe, it } from 'node:test';

import { listCookieSources } from '../../../src/browser/browser-cookies.js';
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
