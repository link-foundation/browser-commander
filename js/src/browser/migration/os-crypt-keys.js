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
 * Which keystore a launch encrypts its new profile with: `'mock'` when the
 * launch switches bypass the OS keystore (`--use-mock-keychain` on macOS, as
 * Chrome for Testing gets by default, or `--password-store=basic` on Linux),
 * `'os'` otherwise.
 *
 * @param {string[]} args - The browser command-line switches
 * @param {string} platform
 * @returns {'mock'|'os'}
 */
export function targetKeystoreFor(args, platform) {
  const bypass =
    platform === 'darwin' ? '--use-mock-keychain' : '--password-store=basic';
  return platform !== 'win32' && args.includes(bypass) ? 'mock' : 'os';
}

/**
 * Resolve the target (launching) profile's encryption key on macOS/Linux.
 *
 * macOS Chromium only knows the `v10` tag; Linux tags keyring keys `v11` and
 * its fixed basic-store key `v10`. A `'mock'` keystore uses Chromium's fixed
 * mock passwords: `mock_password` for the mock keychain, `peanuts` for the
 * basic store.
 *
 * @param {Object} options
 * @param {string} options.browser - Launching browser channel
 * @param {string} options.platform
 * @param {'mock'|'os'} [options.keystore='os'] - See `targetKeystoreFor`
 * @param {Object} [options.environment]
 * @param {Function} [options.readSafeStoragePassword]
 * @returns {Promise<{key: Buffer, prefix: string}>}
 */
export async function resolveTargetKey({
  browser,
  platform,
  keystore = 'os',
  environment = process.env,
  readSafeStoragePassword: readSafeStorage = readSafeStoragePassword,
}) {
  if (platform !== 'darwin' && platform !== 'linux') {
    throw new Error(
      `resolveTargetKey does not derive a Windows key; use createWindowsProfileKey`
    );
  }
  if (keystore === 'mock') {
    const password = platform === 'darwin' ? 'mock_password' : 'peanuts';
    return { key: deriveChromiumCookieKey(password, platform), prefix: 'v10' };
  }
  const password = await readSafeStorage({ browser, platform, environment });
  return {
    key: deriveChromiumCookieKey(password, platform),
    prefix: platform === 'darwin' ? 'v10' : 'v11',
  };
}

/** Convenience: the Local State path next to a profile directory. */
export { localStatePathForProfile } from '../browser-profile-files.js';
