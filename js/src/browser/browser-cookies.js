import path from 'node:path';
import os from 'node:os';
import { TextDecoder } from 'node:util';

import Database from 'better-sqlite3';

import {
  clearBrowserCookieMemoryCache,
  getCachedCredential,
  normalizeCookieCache,
  readCookieResultCache,
  writeCookieResultCache,
} from './browser-cookie-cache.js';
import {
  chromiumSameSite,
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
  findCookieDatabase,
  listBrowserProfiles,
  normalizeCookieBrowser,
  resolveBrowserProfile,
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
  const statement = database.prepare(query).safeIntegers();
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

function mapFirefoxRows(rows) {
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
    return getCachedCredential({
      cache: context.cache,
      identity: `${context.browser}:${context.platform}:safe-storage`,
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
    });
  }
  if (context.platform === 'win32') {
    return getCachedCredential({
      cache: context.cache,
      identity: `${context.browser}:win32:legacy-aes-key`,
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
    });
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
    return new TextDecoder('utf8', { fatal: true }).decode(plaintext);
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
          `Could not decrypt cookie ${row.name} for ${row.host_key}: ${error.message}`
        );
      }
    }
  }
  return cookies;
}

function openCookieDatabase(cookiePath) {
  try {
    return new Database(cookiePath, { fileMustExist: true, readonly: true });
  } catch (error) {
    throw new Error(`Could not open browser cookie database: ${error.message}`);
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
  const browser = normalizeCookieBrowser(options.browser);
  const platform = dependencies.platform ?? process.platform;
  const homeDir = dependencies.homeDir ?? os.homedir();
  const environment = dependencies.environment ?? process.env;
  const profile = await resolveBrowserProfile({
    browser,
    profile: options.profile,
    platform,
    homeDir,
    environment,
  });
  const cookiePath = await findCookieDatabase(browser, profile.path, platform);
  if (!cookiePath) {
    throw new Error(`No cookie database exists in ${profile.path}`);
  }
  const cache = normalizeCookieCache(
    options.cache,
    homeDir,
    options.ttlMinutes
  );
  const identity = JSON.stringify({
    browser,
    profile: profile.path,
    domainFilter: options.domainFilter ?? null,
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

  const database = openCookieDatabase(cookiePath);
  let cookies;
  try {
    if (browser === 'firefox') {
      cookies = mapFirefoxRows(readFirefoxRows(database, options.domainFilter));
    } else {
      const databaseVersion = readDatabaseVersion(database);
      const rows = readChromiumRows(database, options.domainFilter);
      cookies = await mapChromiumRows(rows, databaseVersion, {
        browser,
        cache,
        decryptWindowsDpapi:
          dependencies.decryptWindowsDpapi ?? decryptWindowsDpapi,
        environment,
        ignoreDecryptionErrors: options.ignoreDecryptionErrors === true,
        now,
        platform,
        profile,
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

export {
  clearBrowserCookieMemoryCache,
  decryptChromiumCookie,
  listBrowserProfiles,
};
