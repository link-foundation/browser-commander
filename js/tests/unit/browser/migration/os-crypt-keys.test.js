import assert from 'node:assert';
import { describe, it } from 'node:test';
import path from 'node:path';

import {
  createSourceKeyResolver,
  localStatePathForProfile,
  resolveTargetKey,
} from '../../../../src/browser/migration/os-crypt-keys.js';
import { deriveChromiumCookieKey } from '../../../../src/browser/browser-cookie-crypto.js';

describe('createSourceKeyResolver', () => {
  it('uses the hardcoded key for Linux v10', async () => {
    const resolve = createSourceKeyResolver({
      browser: 'chromium',
      platform: 'linux',
    });
    const key = await resolve('v10');
    assert.deepEqual(key, deriveChromiumCookieKey('peanuts', 'linux'));
  });

  it('derives the Safe Storage key for Linux v11 and caches it', async () => {
    let calls = 0;
    const resolve = createSourceKeyResolver({
      browser: 'chrome',
      platform: 'linux',
      readSafeStoragePassword: async () => {
        calls += 1;
        return 'keyring-pass';
      },
    });
    const first = await resolve('v11');
    const second = await resolve('v11');
    assert.deepEqual(first, deriveChromiumCookieKey('keyring-pass', 'linux'));
    assert.deepEqual(second, first);
    assert.equal(calls, 1);
  });

  it('reads the Windows key from Local State', async () => {
    const windowsKey = Buffer.alloc(32, 9);
    const resolve = createSourceKeyResolver({
      browser: 'chrome',
      platform: 'win32',
      localStatePath: '/fake/Local State',
      readWindowsEncryptionKey: async ({ localStatePath }) => {
        assert.equal(localStatePath, '/fake/Local State');
        return windowsKey;
      },
    });
    assert.deepEqual(await resolve('v10'), windowsKey);
  });

  it('derives the macOS Safe Storage key', async () => {
    const resolve = createSourceKeyResolver({
      browser: 'chrome',
      platform: 'darwin',
      readSafeStoragePassword: async () => 'mac-pass',
    });
    assert.deepEqual(
      await resolve('v10'),
      deriveChromiumCookieKey('mac-pass', 'darwin')
    );
  });
});

describe('resolveTargetKey', () => {
  it('derives the launching profile key on macOS/Linux', async () => {
    const result = await resolveTargetKey({
      browser: 'chrome',
      platform: 'linux',
      readSafeStoragePassword: async () => 'target-pass',
    });
    assert.deepEqual(
      result.key,
      deriveChromiumCookieKey('target-pass', 'linux')
    );
    assert.equal(result.prefix, 'v11');
  });

  it('refuses to derive a Windows key', async () => {
    await assert.rejects(
      resolveTargetKey({ browser: 'chrome', platform: 'win32' }),
      /createWindowsProfileKey/
    );
  });
});

describe('localStatePathForProfile', () => {
  it('points at Local State next to the profile directory', () => {
    assert.equal(
      localStatePathForProfile('/root/google-chrome/Default'),
      path.join('/root/google-chrome', 'Local State')
    );
  });
});
