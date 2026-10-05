import path from 'node:path';

import { pathExists } from './fs-utils.js';
import { matchesDomains } from './domains.js';

import { readBrowserCookies } from '../browser-cookies.js';

/**
 * Cookie migration.
 *
 * Cookies are read from the source profile with the existing
 * {@link readBrowserCookies} (which handles the per-platform keystore and the
 * v10/v11 decryption), optionally filtered by domain, and returned so the
 * launcher can seed them into the dedicated profile over CDP with the existing
 * `seedCookies` path. This module does not write anything into the target
 * profile itself; the CDP seed is what a real, running browser accepts.
 *
 * ## Device Bound Session Credentials (DBSC)
 *
 * Google has shipped Device Bound Session Credentials: the session is bound to
 * a private key held in the device's TPM or Secure Enclave, and the short
 * "session token" cookies are rotated by the browser using that key. The key
 * cannot leave the profile, so a copied Google session cannot be refreshed
 * from another profile and expires quickly. Chrome's guidance is to report
 * this rather than fail silently.
 *
 * References:
 * - https://developer.chrome.com/docs/web-platform/device-bound-session-credentials
 * - https://github.com/WICG/dbsc (the DBSC explainer)
 * - https://www.helpnetsecurity.com/2026/04/10/google-chrome-device-bound-session-credentials/
 *
 * Detection is twofold:
 *
 * 1. By name+domain: the rotating bound cookies Chrome refreshes for a Google
 *    sign-in are `__Secure-1PSIDTS`, `__Secure-3PSIDTS` and `SIDTS` on
 *    `google.*`/`accounts.google.com` hosts. These are copied (so the rest of
 *    the session's cookies stay coherent) but reported in `skipped` with the
 *    reason `dbsc-bound`, because they will not survive rotation in the new
 *    profile.
 * 2. By registration: if the source profile stores a DBSC registration
 *    database (`DeviceBoundSessions`, written under the profile's `Network`
 *    directory), a warning is added noting that any cookie covered by a bound
 *    session is subject to the same limitation. The registration itself is not
 *    copied because it is bound to the source device's key.
 */

/** Rotating Google session-token cookies that DBSC binds to the device key. */
export const DBSC_BOUND_COOKIE_NAMES = Object.freeze([
  '__Secure-1PSIDTS',
  '__Secure-3PSIDTS',
  'SIDTS',
]);

/** DBSC registration databases Chrome may write in the profile. */
const DBSC_REGISTRATION_FILES = [
  'Network/DeviceBoundSessions',
  'DeviceBoundSessions',
];

function isGoogleHost(domain) {
  const host = (domain ?? '').replace(/^\./, '').toLowerCase();
  return (
    host === 'google.com' ||
    host.endsWith('.google.com') ||
    /(^|\.)google\.[a-z.]+$/.test(host)
  );
}

/**
 * Decide whether a cookie is a DBSC-bound Google session cookie.
 *
 * @param {{name: string, domain: string}} cookie
 * @returns {boolean}
 */
export function isDbscBoundCookie(cookie) {
  return (
    isGoogleHost(cookie.domain) && DBSC_BOUND_COOKIE_NAMES.includes(cookie.name)
  );
}

async function findDbscRegistration(profileDir) {
  for (const relative of DBSC_REGISTRATION_FILES) {
    const candidate = path.join(profileDir, relative);
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Read cookies from the source browser, tag the DBSC-bound ones, and return the
 * cookies to seed plus the migration report fragment.
 *
 * @param {Object} options
 * @param {string} options.browser - chrome | edge | brave | chromium
 * @param {string} [options.profile] - Source profile name
 * @param {string} [options.sourceProfileDir] - Source profile directory (for DBSC detection)
 * @param {string[]} [options.domains] - Optional domain filter (substring match)
 * @param {Function} [options.readCookies=readBrowserCookies] - Injectable reader
 * @param {Object} [options.readerOptions] - Extra options for the reader (platform, homeDir, ...)
 * @returns {Promise<{cookies: Object[], migrated: number, skipped: Array, warnings: Array}>}
 */
export async function migrateCookies({
  browser,
  profile,
  sourceProfileDir,
  domains,
  readCookies = readBrowserCookies,
  readerOptions = {},
}) {
  const domainFilters =
    Array.isArray(domains) && domains.length > 0 ? domains : [null];

  const seen = new Map();
  for (const domainFilter of domainFilters) {
    const batch = await readCookies({
      browser,
      profile,
      // Read from the exact directory the migration resolved (which honours a
      // custom `userDataDir`) instead of re-resolving the default profile.
      profileDir: sourceProfileDir,
      domainFilter: domainFilter ?? undefined,
      ignoreDecryptionErrors: true,
      ...readerOptions,
    });
    for (const cookie of batch) {
      seen.set(
        `${cookie.domain}\u0000${cookie.name}\u0000${cookie.path}`,
        cookie
      );
    }
  }
  const cookies = [...seen.values()].filter((cookie) =>
    matchesDomains(cookie.domain, domains)
  );

  const skipped = [];
  for (const cookie of cookies) {
    if (isDbscBoundCookie(cookie)) {
      skipped.push({
        type: 'cookies',
        item: `${cookie.domain} ${cookie.name}`,
        reason: 'dbsc-bound',
      });
    }
  }

  const warnings = [];
  if (sourceProfileDir && (await findDbscRegistration(sourceProfileDir))) {
    warnings.push({
      type: 'cookies',
      item: 'DeviceBoundSessions',
      reason: 'dbsc-registration-present',
      detail:
        'The source profile has a Device Bound Session registration; cookies covered by it are bound to the source device key and will expire in the migrated profile.',
    });
  }

  return { cookies, migrated: cookies.length, skipped, warnings };
}
