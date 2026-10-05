import path from 'node:path';
import os from 'node:os';

import {
  clearBrowserCookieMemoryCache,
  getCachedCredential,
  normalizeCookieCache,
  readCookieResultCache,
  writeCookieResultCache,
} from './browser-cookie-cache.js';
import {
  chromiumSameSite,
  decodeChromiumCookiePlaintext,
  decryptChromiumCookie,
  deriveChromiumCookieKey,
  firefoxSameSite,
} from './browser-cookie-crypto.js';
import {
  decryptWindowsDpapi,
  readSafeStoragePassword,
  readWindowsEncryptionKey,
} from './browser-cookie-credentials.js';
import {
  openSqliteDatabase,
  preserveIntegerPrecision,
} from './browser-cookie-database.js';
import { browserFamily } from './browser-sources.js';
import {
  findCookieDatabase,
  listBrowserProfiles,
  resolveBrowserProfile,
  resolveSourceBrowser,
} from './browser-profiles.js';

const CHROME_EPOCH_OFFSET_SECONDS = 11_644_473_600n;
const MICROSECONDS_PER_SECOND = 1_000_000n;

function toNumber(value) {
  return typeof value === 'bigint' ? Number(value) : Number(value ?? 0);
}

function chromiumExpires(value) {
  const microseconds = BigInt(value ?? 0);
  if (microseconds === 0n) {
    return -1;
  }
  return Number(
    microseconds / MICROSECONDS_PER_SECOND - CHROME_EPOCH_OFFSET_SECONDS
  );
}

function firefoxExpires(value) {
  const expires = toNumber(value);
  return expires > 0 ? expires : -1;
}

function queryRows(database, query, domainFilter) {
  const statement = preserveIntegerPrecision(database.prepare(query));
  return domainFilter ? statement.all(`%${domainFilter}%`) : statement.all();
}

function readDatabaseVersion(database) {
  try {
    const row = database
      .prepare("SELECT value FROM meta WHERE key = 'version'")
      .get();
    return Number(row?.value ?? 0);
  } catch {
    return 0;
  }
}

function readFirefoxRows(database, domainFilter) {
  return queryRows(
    database,
    `SELECT name, value, host, path, expiry, isSecure, isHttpOnly, sameSite
       FROM moz_cookies
      ${domainFilter ? 'WHERE host LIKE ?' : ''}
      ORDER BY host, name, path`,
    domainFilter
  );
}

function readChromiumRows(database, domainFilter) {
  return queryRows(
    database,
    `SELECT host_key, name, value, encrypted_value, path, expires_utc,
            is_secure, is_httponly, samesite
       FROM cookies
      ${domainFilter ? 'WHERE host_key LIKE ?' : ''}
      ORDER BY host_key, name, path`,
    domainFilter
  );
}

/** Map `moz_cookies` rows to cookies; profile migration reuses this too. */
export function mapFirefoxCookieRows(rows) {
  return rows.map((row) => ({
    name: row.name,
    value: row.value,
    domain: row.host,
    path: row.path || '/',
    expires: firefoxExpires(row.expiry),
    httpOnly: Boolean(row.isHttpOnly),
    secure: Boolean(row.isSecure),
    sameSite: firefoxSameSite(row.sameSite),
  }));
}

function encryptionPrefix(encryptedValue) {
  return Buffer.from(encryptedValue).subarray(0, 3).toString('ascii');
}

function chromiumKeyForPrefix(context, prefix) {
  if (context.platform === 'linux' && prefix === 'v10') {
    return deriveChromiumCookieKey('peanuts', 'linux');
  }
  if (context.platform === 'linux' || context.platform === 'darwin') {
    const identity = `${context.browser}:${context.platform}:safe-storage`;
    if (!context.credentialKeys.has(identity)) {
      context.credentialKeys.set(
        identity,
        getCachedCredential({
          cache: context.cache,
          identity,
          refresh: context.refresh,
          now: context.now,
          metadata: {
            browser: context.browser,
            platform: context.platform,
            source: 'safe-storage',
          },
          create: async () =>
            deriveChromiumCookieKey(
              await context.readSafeStoragePassword({
                browser: context.browser,
                platform: context.platform,
                environment: context.environment,
              }),
              context.platform
            ),
        })
      );
    }
    return context.credentialKeys.get(identity);
  }
  if (context.platform === 'win32') {
    const identity = `${context.browser}:win32:legacy-aes-key`;
    if (!context.credentialKeys.has(identity)) {
      context.credentialKeys.set(
        identity,
        getCachedCredential({
          cache: context.cache,
          identity,
          refresh: context.refresh,
          now: context.now,
          metadata: {
            browser: context.browser,
            platform: context.platform,
            source: 'dpapi',
          },
          create: () =>
            context.readWindowsEncryptionKey({
              localStatePath: path.join(
                path.dirname(context.profile.path),
                'Local State'
              ),
              environment: context.environment,
              decryptDpapi: context.decryptWindowsDpapi,
            }),
        })
      );
    }
    return context.credentialKeys.get(identity);
  }
  throw new Error(
    `Chromium cookie decryption is unsupported on ${context.platform}`
  );
}

async function decryptChromiumRow(row, databaseVersion, context) {
  if (row.value) {
    return row.value;
  }
  const encryptedValue = Buffer.from(row.encrypted_value);
  if (encryptedValue.length === 0) {
    return '';
  }
  const prefix = encryptionPrefix(encryptedValue);
  if (context.platform === 'win32' && prefix !== 'v10' && prefix !== 'v11') {
    if (prefix === 'v20') {
      return decryptChromiumCookie({
        encryptedValue,
        host: row.host_key,
        databaseVersion,
        platform: context.platform,
        key: Buffer.alloc(32),
      });
    }
    const plaintext = await context.decryptWindowsDpapi(encryptedValue, {
      environment: context.environment,
    });
    return decodeChromiumCookiePlaintext({
      plaintext,
      host: row.host_key,
      databaseVersion,
    });
  }
  const key = await chromiumKeyForPrefix(context, prefix);
  return decryptChromiumCookie({
    encryptedValue,
    host: row.host_key,
    databaseVersion,
    platform: context.platform,
    key,
  });
}

async function mapChromiumRows(rows, databaseVersion, context) {
  const cookies = [];
  for (const row of rows) {
    try {
      cookies.push({
        name: row.name,
        value: await decryptChromiumRow(row, databaseVersion, context),
        domain: row.host_key,
        path: row.path || '/',
        expires: chromiumExpires(row.expires_utc),
        httpOnly: Boolean(row.is_httponly),
        secure: Boolean(row.is_secure),
        sameSite: chromiumSameSite(row.samesite),
      });
    } catch (error) {
      if (!context.ignoreDecryptionErrors) {
        throw new Error(
          `Could not decrypt cookie ${row.name} for ${row.host_key}: ${error.message}`,
          { cause: error }
        );
      }
    }
  }
  return cookies;
}

async function openCookieDatabase(cookiePath) {
  try {
    return await openSqliteDatabase(cookiePath, {
      fileMustExist: true,
      readOnly: true,
    });
  } catch (error) {
    throw new Error(
      `Could not open browser cookie database: ${error.message}`,
      { cause: error }
    );
  }
}

/**
 * Read cookies from an installed browser profile in Playwright/Puppeteer shape.
 * Use dependency injection only for deterministic platform and credential tests.
 */
export async function readBrowserCookiesWithDependencies(
  options,
  dependencies = {}
) {
  if (!options || typeof options !== 'object') {
    throw new TypeError('readBrowserCookies requires an options object');
  }
  const platform = dependencies.platform ?? process.platform;
  const homeDir = dependencies.homeDir ?? os.homedir();
  const environment = dependencies.environment ?? process.env;
  const runCommand = dependencies.runCommand;
  const browser = await resolveSourceBrowser(options.browser, {
    platform,
    environment,
    runCommand,
  });
  // A caller that already resolved the profile directory (for example a
  // migration honouring a custom `userDataDir`) passes it as `profileDir`, so
  // the reader does not re-resolve the default profile location.
  const profilePath = options.profileDir
    ? options.profileDir
    : (
        await resolveBrowserProfile({
          browser,
          profile: options.profile,
          platform,
          homeDir,
          environment,
          runCommand,
        })
      ).path;
  const cookiePath = await findCookieDatabase(browser, profilePath, platform);
  if (!cookiePath) {
    throw new Error(`No cookie database exists in ${profilePath}`);
  }
  const cache = normalizeCookieCache(
    options.cache,
    homeDir,
    options.ttlMinutes
  );
  const identity = JSON.stringify({
    browser,
    profile: profilePath,
    domainFilter: options.domainFilter ?? null,
    ignoreDecryptionErrors: options.ignoreDecryptionErrors === true,
  });
  const now = dependencies.now ?? Date.now;
  const cachedCookies = await readCookieResultCache({
    cache,
    identity,
    refresh: options.refresh === true,
    now,
  });
  if (cachedCookies) {
    return cachedCookies;
  }

  const database = await openCookieDatabase(cookiePath);
  let cookies;
  try {
    if (browserFamily(browser) === 'firefox') {
      cookies = mapFirefoxCookieRows(
        readFirefoxRows(database, options.domainFilter)
      );
    } else {
      const databaseVersion = readDatabaseVersion(database);
      const rows = readChromiumRows(database, options.domainFilter);
      cookies = await mapChromiumRows(rows, databaseVersion, {
        browser,
        cache,
        credentialKeys: new Map(),
        decryptWindowsDpapi:
          dependencies.decryptWindowsDpapi ?? decryptWindowsDpapi,
        environment,
        ignoreDecryptionErrors: options.ignoreDecryptionErrors === true,
        now,
        platform,
        profile: { path: profilePath },
        readSafeStoragePassword:
          dependencies.readSafeStoragePassword ?? readSafeStoragePassword,
        readWindowsEncryptionKey:
          dependencies.readWindowsEncryptionKey ?? readWindowsEncryptionKey,
        refresh: options.refresh === true,
      });
    }
  } finally {
    database.close();
  }
  await writeCookieResultCache({ cache, identity, cookies, now });
  return cookies;
}

/** Read cookies from an installed Chrome, Edge, Brave, Chromium, or Firefox. */
export function readBrowserCookies(options) {
  return readBrowserCookiesWithDependencies(options);
}

/**
 * Count cookies in a database by domain, without ever reading a cookie value.
 * Only host names and row counts are touched, so this is safe to expose for a
 * "which browser holds cookies for this domain" listing.
 */
function countCookiesByDomain(database, family, domains) {
  const column = family === 'firefox' ? 'host' : 'host_key';
  const table = family === 'firefox' ? 'moz_cookies' : 'cookies';
  const countFor = (filter) => {
    const query = filter
      ? `SELECT COUNT(*) AS n FROM ${table} WHERE ${column} LIKE ?`
      : `SELECT COUNT(*) AS n FROM ${table}`;
    const statement = database.prepare(query);
    const row = filter ? statement.get(`%${filter}%`) : statement.get();
    return Number(row?.n ?? 0);
  };
  const total = countFor(null);
  if (!Array.isArray(domains) || domains.length === 0) {
    return { total, byDomain: null };
  }
  const byDomain = {};
  for (const domain of domains) {
    byDomain[domain] = countFor(domain);
  }
  return { total, byDomain };
}

/**
 * List the installed browser profiles that hold cookies, with per-domain
 * counts when `domains` is given. Values are never read or returned — this is
 * the data behind the `cookies sources` command.
 *
 * @param {Object} [options]
 * @param {string[]} [options.domains] - Restrict and count by these domains
 * @param {string} [options.platform=process.platform]
 * @param {string} [options.homeDir=os.homedir()]
 * @param {Object} [options.environment=process.env]
 * @returns {Promise<Array<{browser,profile,path,isDefault,cookies,byDomain,error?}>>}
 */
export async function listCookieSources({
  domains,
  platform = process.platform,
  homeDir = os.homedir(),
  environment = process.env,
} = {}) {
  const profiles = await listBrowserProfiles({
    platform,
    homeDir,
    environment,
  });
  const sources = [];
  for (const profile of profiles) {
    const cookiePath = await findCookieDatabase(
      profile.browser,
      profile.path,
      platform
    );
    if (!cookiePath) {
      continue;
    }
    const family = browserFamily(profile.browser);
    let counts;
    let error;
    let database;
    try {
      database = await openCookieDatabase(cookiePath);
      counts = countCookiesByDomain(database, family, domains);
    } catch (openError) {
      error = openError.message;
    } finally {
      database?.close();
    }
    if (error) {
      sources.push({
        browser: profile.browser,
        profile: profile.name,
        path: profile.path,
        isDefault: profile.isDefault,
        error,
      });
      continue;
    }
    // When filtering by domain, skip profiles that hold none of them.
    const matchedCount = counts.byDomain
      ? Object.values(counts.byDomain).reduce((sum, n) => sum + n, 0)
      : counts.total;
    if (Array.isArray(domains) && domains.length > 0 && matchedCount === 0) {
      continue;
    }
    sources.push({
      browser: profile.browser,
      profile: profile.name,
      path: profile.path,
      isDefault: profile.isDefault,
      cookies: counts.total,
      byDomain: counts.byDomain,
    });
  }
  return sources;
}

export {
  clearBrowserCookieMemoryCache,
  decryptChromiumCookie,
  listBrowserProfiles,
};
