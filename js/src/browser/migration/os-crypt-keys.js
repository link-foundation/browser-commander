import path from 'node:path';

import { deriveChromiumCookieKey } from '../browser-cookie-crypto.js';
import {
  decryptWindowsDpapi,
  readSafeStoragePassword,
  readWindowsEncryptionKey,
} from '../browser-cookie-credentials.js';

/**
 * Resolve the OSCrypt keys a migration needs: the source profile's key (to
 * decrypt) and the target profile's key (to re-encrypt). Both sides reuse the
 * cookie key handling so passwords and cookies share one implementation of the
 * per-platform keystore. Every keystore call is injectable so the whole thing
 * runs on Linux in unit tests.
 *
 * On macOS and Linux the Safe Storage key is per application, not per profile,
 * so the target key is looked up for the launching browser channel. On Windows
 * the target key does not exist yet: the caller generates one with
 * `createWindowsProfileKey` and writes it into the target `Local State`.
 */

/**
 * Build a decryptor key resolver for a source profile, keyed by encryption
 * prefix (Linux uses a hardcoded key for `v10` and the keyring for `v11`).
 *
 * @param {Object} options
 * @param {string} options.browser
 * @param {string} options.platform
 * @param {string} options.localStatePath - Source Local State (Windows key)
 * @param {Object} [options.environment]
 * @param {Function} [options.readSafeStoragePassword]
 * @param {Function} [options.readWindowsEncryptionKey]
 * @param {Function} [options.decryptWindowsDpapi]
 * @returns {function(string): Promise<Buffer>}
 */
export function createSourceKeyResolver({
  browser,
  platform,
  localStatePath,
  environment = process.env,
  readSafeStoragePassword: readSafeStorage = readSafeStoragePassword,
  readWindowsEncryptionKey: readWindowsKey = readWindowsEncryptionKey,
  decryptWindowsDpapi: decryptDpapi = decryptWindowsDpapi,
}) {
  const cache = new Map();
  return (prefix) => {
    const cacheKey = `${prefix}`;
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }
    const promise = (async () => {
      if (platform === 'win32') {
        return readWindowsKey({
          localStatePath,
          environment,
          decryptDpapi,
        });
      }
      if (platform === 'linux' && prefix === 'v10') {
        return deriveChromiumCookieKey('peanuts', 'linux');
      }
      if (platform === 'linux' || platform === 'darwin') {
        const password = await readSafeStorage({
          browser,
          platform,
          environment,
        });
        return deriveChromiumCookieKey(password, platform);
      }
      throw new Error(`OSCrypt keys are unsupported on ${platform}`);
    })();
    cache.set(cacheKey, promise);
    return promise;
  };
}

/**
 * Resolve the target (launching) profile's encryption key on macOS/Linux.
 *
 * @param {Object} options
 * @param {string} options.browser - Launching browser channel
 * @param {string} options.platform
 * @param {Object} [options.environment]
 * @param {Function} [options.readSafeStoragePassword]
 * @returns {Promise<{key: Buffer, prefix: string}>}
 */
export async function resolveTargetKey({
  browser,
  platform,
  environment = process.env,
  readSafeStoragePassword: readSafeStorage = readSafeStoragePassword,
}) {
  if (platform === 'darwin' || platform === 'linux') {
    const password = await readSafeStorage({ browser, platform, environment });
    return { key: deriveChromiumCookieKey(password, platform), prefix: 'v11' };
  }
  throw new Error(
    `resolveTargetKey does not derive a Windows key; use createWindowsProfileKey`
  );
}

/** Convenience: the Local State path next to a profile directory. */
export function localStatePathForProfile(profileDir) {
  return path.join(path.dirname(profileDir), 'Local State');
}
