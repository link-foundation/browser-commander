import {
  createDecipheriv,
  createHash,
  pbkdf2Sync,
  timingSafeEqual,
} from 'node:crypto';
import { TextDecoder } from 'node:util';

const CHROMIUM_CBC_IV = Buffer.alloc(16, 0x20);
const DOMAIN_HASH_BYTES = 32;

export function deriveChromiumCookieKey(password, platform) {
  if (platform !== 'darwin' && platform !== 'linux') {
    throw new Error(`CBC cookie keys are not used on ${platform}`);
  }
  return pbkdf2Sync(
    password,
    'saltysalt',
    platform === 'darwin' ? 1003 : 1,
    16,
    'sha1'
  );
}

function removeDomainHash(plaintext, host, databaseVersion) {
  if (databaseVersion < 24) {
    return plaintext;
  }
  if (plaintext.length < DOMAIN_HASH_BYTES) {
    throw new Error('decrypted cookie is missing its domain hash');
  }
  const expectedHash = createHash('sha256').update(host).digest();
  const actualHash = plaintext.subarray(0, DOMAIN_HASH_BYTES);
  if (!timingSafeEqual(actualHash, expectedHash)) {
    throw new Error('decrypted cookie domain hash does not match its host');
  }
  return plaintext.subarray(DOMAIN_HASH_BYTES);
}

function decodeCookieValue(plaintext) {
  return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
}

/** Validate and decode plaintext returned by a Chromium platform decryptor. */
export function decodeChromiumCookiePlaintext({
  plaintext,
  host,
  databaseVersion = 0,
}) {
  return decodeCookieValue(
    removeDomainHash(Buffer.from(plaintext), host, databaseVersion)
  );
}

function decryptCbcCookie(encryptedValue, key) {
  const decipher = createDecipheriv('aes-128-cbc', key, CHROMIUM_CBC_IV);
  return Buffer.concat([
    decipher.update(encryptedValue.subarray(3)),
    decipher.final(),
  ]);
}

function decryptGcmCookie(encryptedValue, key) {
  const payload = encryptedValue.subarray(3);
  if (payload.length < 12 + 16) {
    throw new Error('encrypted AES-GCM cookie is truncated');
  }
  const nonce = payload.subarray(0, 12);
  const authenticationTag = payload.subarray(-16);
  const ciphertext = payload.subarray(12, -16);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(authenticationTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** Decrypt a Chromium cookie encrypted_value using an already recovered key. */
export function decryptChromiumCookie({
  encryptedValue,
  host,
  databaseVersion = 0,
  platform = process.platform,
  key,
}) {
  const encrypted = Buffer.from(encryptedValue);
  const prefix = encrypted.subarray(0, 3).toString('ascii');
  if (prefix === 'v20') {
    throw new Error(
      'Windows app-bound v20 cookies cannot be decrypted outside the browser; use a browser-supported export or a previously saved storage state'
    );
  }
  if (prefix !== 'v10' && prefix !== 'v11') {
    throw new Error(
      'cookie does not use a supported Chromium encryption prefix'
    );
  }
  if (!Buffer.isBuffer(key)) {
    throw new TypeError('a recovered cookie encryption key is required');
  }
  const plaintext =
    platform === 'win32'
      ? decryptGcmCookie(encrypted, key)
      : decryptCbcCookie(encrypted, key);
  return decodeChromiumCookiePlaintext({
    plaintext,
    host,
    databaseVersion,
  });
}

export function chromiumSameSite(value) {
  if (Number(value) === 2) {
    return 'Strict';
  }
  if (Number(value) === 1) {
    return 'Lax';
  }
  return 'None';
}

export function firefoxSameSite(value) {
  if (Number(value) === 2) {
    return 'Strict';
  }
  if (Number(value) === 1) {
    return 'Lax';
  }
  return 'None';
}
