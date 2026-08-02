import assert from 'node:assert';
import { execFile as execFileCallback } from 'node:child_process';
import {
  createCipheriv,
  createHash,
  pbkdf2Sync,
  randomBytes,
} from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, it } from 'node:test';

import Database from 'better-sqlite3';

import {
  clearBrowserCookieMemoryCache,
  decryptChromiumCookie,
  listBrowserProfiles,
  readBrowserCookies,
  readBrowserCookiesWithDependencies,
} from '../../../src/browser/browser-cookies.js';
import {
  listBrowserProfiles as publicListBrowserProfiles,
  readBrowserCookies as publicReadBrowserCookies,
} from '../../../src/index.js';

const CHROME_EPOCH_OFFSET_SECONDS = 11_644_473_600;
const execFile = promisify(execFileCallback);
const credentialWorker = fileURLToPath(
  new URL('../../fixtures/browser-cookie-cache-worker.mjs', import.meta.url)
);

function chromeExpires(unixSeconds) {
  return (unixSeconds + CHROME_EPOCH_OFFSET_SECONDS) * 1_000_000;
}

function encryptCbcCookie({ host, value, password, prefix = 'v11' }) {
  const key = pbkdf2Sync(password, 'saltysalt', 1, 16, 'sha1');
  const plaintext = Buffer.concat([
    createHash('sha256').update(host).digest(),
    Buffer.from(value),
  ]);
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
  return Buffer.concat([
    Buffer.from(prefix),
    cipher.update(plaintext),
    cipher.final(),
  ]);
}

function encryptGcmCookie({ host, value, key, prefix = 'v10' }) {
  const nonce = randomBytes(12);
  const plaintext = Buffer.concat([
    createHash('sha256').update(host).digest(),
    Buffer.from(value),
  ]);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([
    Buffer.from(prefix),
    nonce,
    ciphertext,
    cipher.getAuthTag(),
  ]);
}

async function createChromiumProfile({ homeDir, rows, profile = 'Default' }) {
  const root = path.join(homeDir, '.config', 'google-chrome');
  const profilePath = path.join(root, profile);
  const cookiePath = path.join(profilePath, 'Network', 'Cookies');
  await mkdir(path.dirname(cookiePath), { recursive: true });
  await writeFile(
    path.join(root, 'Local State'),
    JSON.stringify({
      profile: {
        last_used: profile,
        info_cache: { [profile]: { name: 'Primary profile' } },
      },
    })
  );

  const database = new Database(cookiePath);
  database.exec(`
    CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
    INSERT INTO meta (key, value) VALUES ('version', '24');
    CREATE TABLE cookies (
      host_key TEXT NOT NULL,
      name TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      encrypted_value BLOB NOT NULL DEFAULT '',
      path TEXT NOT NULL,
      expires_utc INTEGER NOT NULL,
      is_secure INTEGER NOT NULL,
      is_httponly INTEGER NOT NULL,
      samesite INTEGER NOT NULL
    );
  `);
  const insert = database.prepare(`
    INSERT INTO cookies (
      host_key, name, value, encrypted_value, path, expires_utc,
      is_secure, is_httponly, samesite
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of rows) {
    insert.run(
      row.host,
      row.name,
      row.value ?? '',
      row.encryptedValue ?? Buffer.alloc(0),
      row.path ?? '/',
      row.expiresUtc ?? 0,
      row.secure ? 1 : 0,
      row.httpOnly ? 1 : 0,
      row.sameSite ?? -1
    );
  }
  database.close();
  return { cookiePath, profilePath, root };
}

async function createFirefoxProfile({ homeDir, rows }) {
  const root = path.join(homeDir, '.mozilla', 'firefox');
  const profileName = 'fixture.default-release';
  const profilePath = path.join(root, profileName);
  const cookiePath = path.join(profilePath, 'cookies.sqlite');
  await mkdir(profilePath, { recursive: true });
  await writeFile(
    path.join(root, 'profiles.ini'),
    `[Profile0]\nName=default-release\nIsRelative=1\nPath=${profileName}\nDefault=1\n`
  );
  const database = new Database(cookiePath);
  database.exec(`
    CREATE TABLE moz_cookies (
      name TEXT,
      value TEXT,
      host TEXT,
      path TEXT,
      expiry INTEGER,
      isSecure INTEGER,
      isHttpOnly INTEGER,
      sameSite INTEGER
    );
  `);
  const insert = database.prepare(`
    INSERT INTO moz_cookies
      (name, value, host, path, expiry, isSecure, isHttpOnly, sameSite)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of rows) {
    insert.run(
      row.name,
      row.value,
      row.host,
      row.path ?? '/',
      row.expiry ?? 0,
      row.secure ? 1 : 0,
      row.httpOnly ? 1 : 0,
      row.sameSite ?? 0
    );
  }
  database.close();
  return { cookiePath, profilePath, root };
}

describe('installed browser cookie import', () => {
  let temporaryDirectory;

  afterEach(async () => {
    clearBrowserCookieMemoryCache();
    if (temporaryDirectory) {
      await chmod(temporaryDirectory, 0o700);
      await rm(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = undefined;
    }
  });

  it('exports both public helpers', () => {
    assert.equal(publicListBrowserProfiles, listBrowserProfiles);
    assert.equal(publicReadBrowserCookies, readBrowserCookies);
  });

  it('discovers named Chromium and Firefox profiles', async () => {
    temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'browser-commander-cookie-profiles-')
    );
    const chromium = await createChromiumProfile({
      homeDir: temporaryDirectory,
      rows: [],
    });
    const firefox = await createFirefoxProfile({
      homeDir: temporaryDirectory,
      rows: [],
    });

    const profiles = await listBrowserProfiles({
      platform: 'linux',
      homeDir: temporaryDirectory,
      environment: {},
    });

    assert.deepEqual(profiles, [
      {
        browser: 'chrome',
        name: 'Default',
        displayName: 'Primary profile',
        path: chromium.profilePath,
        isDefault: true,
      },
      {
        browser: 'firefox',
        name: 'default-release',
        displayName: 'default-release',
        path: firefox.profilePath,
        isDefault: true,
      },
    ]);
  });

  it('decrypts Chromium CBC cookies and returns the engine cookie shape', async () => {
    temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'browser-commander-cookie-read-')
    );
    const password = 'fixture safe storage password';
    const host = '.example.com';
    await createChromiumProfile({
      homeDir: temporaryDirectory,
      rows: [
        {
          host,
          name: 'SID',
          encryptedValue: encryptCbcCookie({
            host,
            value: 'decrypted-session',
            password,
          }),
          expiresUtc: chromeExpires(2_000_000_000),
          secure: true,
          httpOnly: true,
          sameSite: 2,
        },
        {
          host: '.other.test',
          name: 'ignored',
          value: 'plain',
        },
      ],
    });

    let credentialReads = 0;
    const cookies = await readBrowserCookiesWithDependencies(
      {
        browser: 'chrome',
        domainFilter: 'example.com',
        cache: {
          dir: path.join(temporaryDirectory, 'cache'),
          ttlMinutes: 60,
        },
      },
      {
        platform: 'linux',
        homeDir: temporaryDirectory,
        environment: {},
        readSafeStoragePassword: async () => {
          credentialReads += 1;
          return password;
        },
      }
    );

    assert.deepEqual(cookies, [
      {
        name: 'SID',
        value: 'decrypted-session',
        domain: host,
        path: '/',
        expires: 2_000_000_000,
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
      },
    ]);
    assert.equal(credentialReads, 1);
  });

  it('reads Firefox cookies without touching the credential provider', async () => {
    temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'browser-commander-firefox-cookie-')
    );
    await createFirefoxProfile({
      homeDir: temporaryDirectory,
      rows: [
        {
          host: '.example.org',
          name: 'firefox-session',
          value: 'plain-value',
          expiry: 2_000_000_001,
          secure: true,
          sameSite: 1,
        },
      ],
    });

    const cookies = await readBrowserCookiesWithDependencies(
      { browser: 'firefox' },
      {
        platform: 'linux',
        homeDir: temporaryDirectory,
        environment: {},
        readSafeStoragePassword: async () => {
          throw new Error('Firefox must not read an OS credential');
        },
      }
    );

    assert.deepEqual(cookies, [
      {
        name: 'firefox-session',
        value: 'plain-value',
        domain: '.example.org',
        path: '/',
        expires: 2_000_000_001,
        httpOnly: false,
        secure: true,
        sameSite: 'Lax',
      },
    ]);
  });

  it('reuses the owner-only credential cache across memory-cache resets', async () => {
    temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'browser-commander-cookie-cache-')
    );
    const password = 'cached safe storage password';
    const rows = ['.example.com', '.example.org'].map((host, index) => ({
      host,
      name: `session-${index}`,
      encryptedValue: encryptCbcCookie({
        host,
        value: `value-${index}`,
        password,
      }),
    }));
    await createChromiumProfile({ homeDir: temporaryDirectory, rows });
    const cacheDir = path.join(temporaryDirectory, 'cache');
    let credentialReads = 0;
    const dependencies = {
      platform: 'linux',
      homeDir: temporaryDirectory,
      environment: {},
      readSafeStoragePassword: async () => {
        credentialReads += 1;
        return password;
      },
    };

    await readBrowserCookiesWithDependencies(
      {
        browser: 'chrome',
        domainFilter: 'example.com',
        cache: { dir: cacheDir, ttlMinutes: 60 },
      },
      dependencies
    );
    clearBrowserCookieMemoryCache();
    await readBrowserCookiesWithDependencies(
      {
        browser: 'chrome',
        domainFilter: 'example.org',
        cache: { dir: cacheDir, ttlMinutes: 60 },
      },
      dependencies
    );

    assert.equal(credentialReads, 1);
    const cacheFiles = await readdir(cacheDir);
    const credentialFile = cacheFiles.find((name) =>
      name.startsWith('credential-')
    );
    assert.ok(credentialFile);
    const credentialPath = path.join(cacheDir, credentialFile);
    assert.equal((await stat(credentialPath)).mode & 0o777, 0o600);
    const cached = JSON.parse(await readFile(credentialPath, 'utf8'));
    assert.equal(cached.kind, 'derived-key');
    assert.equal(
      cached.key,
      pbkdf2Sync(password, 'saltysalt', 1, 16, 'sha1').toString('base64')
    );
    assert.equal(JSON.stringify(cached).includes(password), false);
  });

  it('coordinates one credential read across separate processes', async () => {
    temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'browser-commander-cookie-process-cache-')
    );
    const cacheDir = path.join(temporaryDirectory, 'cache');
    const credentialReads = path.join(temporaryDirectory, 'credential-reads');

    await Promise.all(
      Array.from({ length: 3 }, () =>
        execFile(process.execPath, [
          credentialWorker,
          cacheDir,
          credentialReads,
        ])
      )
    );

    const readers = (await readFile(credentialReads, 'utf8'))
      .trim()
      .split(/\r?\n/u);
    assert.equal(readers.length, 1);
    const credentialFile = (await readdir(cacheDir)).find((name) =>
      name.startsWith('credential-')
    );
    const cached = JSON.parse(
      await readFile(path.join(cacheDir, credentialFile), 'utf8')
    );
    assert.ok(cached.savedAt < Date.now() / 1000 + 1);
    assert.ok(cached.savedAt > Date.now() / 1000 - 60);
  });

  it('decrypts Windows AES-GCM data and rejects app-bound v20 data', () => {
    const key = randomBytes(32);
    const host = '.example.net';
    const encryptedValue = encryptGcmCookie({
      host,
      value: 'windows-session',
      key,
    });

    assert.equal(
      decryptChromiumCookie({
        encryptedValue,
        host,
        databaseVersion: 24,
        platform: 'win32',
        key,
      }),
      'windows-session'
    );
    assert.throws(
      () =>
        decryptChromiumCookie({
          encryptedValue: Buffer.from('v20app-bound-cookie'),
          host,
          databaseVersion: 24,
          platform: 'win32',
          key,
        }),
      /app-bound.*cannot be decrypted outside the browser/i
    );
  });
});
