import assert from 'node:assert';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  createWindowsProfileKey,
  encryptChromiumValue,
} from '../../../../src/browser/migration/chromium-crypto.js';
import {
  decryptChromiumCookie,
  deriveChromiumCookieKey,
} from '../../../../src/browser/browser-cookie-crypto.js';

describe('encryptChromiumValue', () => {
  for (const platform of ['darwin', 'linux']) {
    it(`round-trips through AES-128-CBC on ${platform}`, () => {
      const key = deriveChromiumCookieKey('safe-storage-pass', platform);
      const encrypted = encryptChromiumValue({
        plaintext: 'hunter2',
        key,
        platform,
        prefix: 'v11',
      });
      assert.equal(encrypted.subarray(0, 3).toString('ascii'), 'v11');
      const decrypted = decryptChromiumCookie({
        encryptedValue: encrypted,
        host: 'accounts.example.com',
        databaseVersion: 0,
        platform,
        key,
      });
      assert.equal(decrypted, 'hunter2');
    });
  }

  it('round-trips through AES-256-GCM on win32', () => {
    const key = randomBytes(32);
    const encrypted = encryptChromiumValue({
      plaintext: 'p@ssw0rd',
      key,
      platform: 'win32',
      prefix: 'v10',
    });
    assert.equal(encrypted.subarray(0, 3).toString('ascii'), 'v10');
    const decrypted = decryptChromiumCookie({
      encryptedValue: encrypted,
      host: 'login.example.com',
      databaseVersion: 0,
      platform: 'win32',
      key,
    });
    assert.equal(decrypted, 'p@ssw0rd');
  });

  it('requires a Buffer key and a supported platform', () => {
    assert.throws(
      () =>
        encryptChromiumValue({
          plaintext: 'x',
          key: 'nope',
          platform: 'linux',
        }),
      /target encryption key/
    );
    assert.throws(
      () =>
        encryptChromiumValue({
          plaintext: 'x',
          key: randomBytes(16),
          platform: 'sunos',
        }),
      /unsupported/
    );
  });
});

describe('createWindowsProfileKey', () => {
  it('tags the DPAPI-protected key and base64-encodes it', async () => {
    const encryptDpapi = (input) => Buffer.concat([Buffer.from('ENC'), input]);
    const { key, encryptedKeyBase64 } = await createWindowsProfileKey({
      encryptDpapi,
      generateKey: () => Buffer.alloc(32, 7),
    });
    assert.equal(key.length, 32);
    const decoded = Buffer.from(encryptedKeyBase64, 'base64');
    assert.equal(decoded.subarray(0, 5).toString('ascii'), 'DPAPI');
    assert.equal(decoded.subarray(5, 8).toString('ascii'), 'ENC');
    assert.deepEqual(decoded.subarray(8), Buffer.alloc(32, 7));
  });

  it('requires an encryptDpapi function', async () => {
    await assert.rejects(createWindowsProfileKey({}), /encryptDpapi/);
  });
});
