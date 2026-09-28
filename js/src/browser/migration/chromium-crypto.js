import { createCipheriv, randomBytes } from 'node:crypto';

/**
 * Re-encryption for Chromium os_crypt values (passwords, and any other value
 * stored the same way as cookies).
 *
 * `browser-cookie-crypto.js` already decrypts these values; this module is the
 * write side, so a value decrypted from the source profile can be encrypted for
 * the dedicated target profile's key. It is dependency-injected end to end so
 * the whole path is unit-testable on Linux with a fabricated key.
 *
 * The wire format matches what Chromium's `OSCrypt` writes:
 * - macOS/Linux: a `v10`/`v11` prefix followed by AES-128-CBC with a fixed
 *   16-byte IV of `0x20`. The key is PBKDF2-SHA1 of the Safe Storage password.
 * - Windows: a `v10` prefix followed by a 12-byte nonce, AES-256-GCM
 *   ciphertext, and the 16-byte auth tag. The key is the random 256-bit key in
 *   `Local State` `os_crypt.encrypted_key`, itself DPAPI-protected.
 *
 * Unlike the Cookies database at schema version 24, `Login Data` values do not
 * carry the SHA-256(host) domain-hash prefix, so nothing is prepended here.
 */

const CBC_IV = Buffer.alloc(16, 0x20);
const GCM_NONCE_BYTES = 12;

/**
 * Encrypt a value the way Chromium's OSCrypt does for the given platform.
 *
 * @param {Object} options
 * @param {string|Buffer} options.plaintext
 * @param {Buffer} options.key
 * @param {string} options.platform - 'darwin' | 'linux' | 'win32'
 * @param {string} [options.prefix] - Version prefix ('v10' or 'v11')
 * @returns {Buffer} The encrypted_value blob
 */
export function encryptChromiumValue({ plaintext, key, platform, prefix }) {
  if (!Buffer.isBuffer(key)) {
    throw new TypeError('a target encryption key is required');
  }
  const data = Buffer.isBuffer(plaintext)
    ? plaintext
    : Buffer.from(String(plaintext), 'utf8');
  if (platform === 'win32') {
    const nonce = randomBytes(GCM_NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
    return Buffer.concat([
      Buffer.from(prefix ?? 'v10'),
      nonce,
      ciphertext,
      cipher.getAuthTag(),
    ]);
  }
  if (platform === 'darwin' || platform === 'linux') {
    const cipher = createCipheriv('aes-128-cbc', key, CBC_IV);
    const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
    return Buffer.concat([Buffer.from(prefix ?? 'v10'), ciphertext]);
  }
  throw new Error(`Chromium value encryption is unsupported on ${platform}`);
}

/**
 * Build the `os_crypt.encrypted_key` a fresh Windows profile needs.
 *
 * Chromium generates a random 256-bit key, DPAPI-protects it in the current
 * user's context, prepends the ASCII tag `DPAPI`, and base64-encodes the result
 * into `Local State`. This mirrors that so a target profile can decrypt values
 * we re-encrypt with the returned raw key. `encryptDpapi` is injected so the
 * generation is testable off Windows.
 *
 * @param {Object} [options]
 * @param {(input: Buffer) => Promise<Buffer>|Buffer} [options.encryptDpapi]
 * @param {() => Buffer} [options.generateKey]
 * @returns {Promise<{key: Buffer, encryptedKeyBase64: string}>}
 */
export async function createWindowsProfileKey({
  encryptDpapi,
  generateKey = () => randomBytes(32),
} = {}) {
  if (typeof encryptDpapi !== 'function') {
    throw new TypeError(
      'createWindowsProfileKey requires an encryptDpapi function'
    );
  }
  const key = generateKey();
  const protectedKey = Buffer.from(await encryptDpapi(key));
  const tagged = Buffer.concat([Buffer.from('DPAPI'), protectedKey]);
  return { key, encryptedKeyBase64: tagged.toString('base64') };
}
