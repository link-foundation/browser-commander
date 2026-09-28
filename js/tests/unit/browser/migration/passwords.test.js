import assert from 'node:assert';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import BetterSqlite3 from 'better-sqlite3';

import { migratePasswords } from '../../../../src/browser/migration/passwords.js';
import { encryptChromiumValue } from '../../../../src/browser/migration/chromium-crypto.js';
import {
  decryptChromiumCookie,
  deriveChromiumCookieKey,
} from '../../../../src/browser/browser-cookie-crypto.js';

const tempDirs = [];

async function makeTempDir(prefix) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeLoginData(dir, rows) {
  const db = new BetterSqlite3(path.join(dir, 'Login Data'));
  db.exec(
    'CREATE TABLE logins (origin_url TEXT, username_value TEXT, password_value BLOB)'
  );
  const insert = db.prepare(
    'INSERT INTO logins (origin_url, username_value, password_value) VALUES (?, ?, ?)'
  );
  for (const row of rows) {
    insert.run(row.originUrl, row.username, row.passwordValue);
  }
  db.close();
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('migratePasswords', () => {
  it('re-encrypts each password for the target key on Linux', async () => {
    const source = await makeTempDir('bc-pw-src-');
    const target = await makeTempDir('bc-pw-dst-');
    const sourceKey = deriveChromiumCookieKey('source-pass', 'linux');
    const targetKey = deriveChromiumCookieKey('target-pass', 'linux');

    writeLoginData(source, [
      {
        originUrl: 'https://a.example/login',
        username: 'alice',
        passwordValue: encryptChromiumValue({
          plaintext: 'secret-A',
          key: sourceKey,
          platform: 'linux',
          prefix: 'v11',
        }),
      },
      {
        originUrl: 'https://b.example/login',
        username: 'bob',
        passwordValue: encryptChromiumValue({
          plaintext: 'secret-B',
          key: sourceKey,
          platform: 'linux',
          prefix: 'v10',
        }),
      },
    ]);

    const report = await migratePasswords({
      sourceProfileDir: source,
      targetProfileDir: target,
      platform: 'linux',
      resolveSourceKey: () => sourceKey,
      targetKey,
      targetPrefix: 'v11',
    });

    assert.equal(report.migrated, 2);
    assert.deepEqual(report.skipped, []);

    const db = new BetterSqlite3(path.join(target, 'Login Data'), {
      readonly: true,
    });
    const stored = db
      .prepare(
        'SELECT origin_url, password_value FROM logins ORDER BY origin_url'
      )
      .all();
    db.close();

    const decrypted = stored.map((row) =>
      decryptChromiumCookie({
        encryptedValue: row.password_value,
        host: new URL(row.origin_url).hostname,
        databaseVersion: 0,
        platform: 'linux',
        key: targetKey,
      })
    );
    assert.deepEqual(decrypted, ['secret-A', 'secret-B']);
  });

  it('reports app-bound v20 passwords as skipped', async () => {
    const source = await makeTempDir('bc-pw-src-');
    const target = await makeTempDir('bc-pw-dst-');
    const targetKey = deriveChromiumCookieKey('target-pass', 'linux');
    writeLoginData(source, [
      {
        originUrl: 'https://locked.example/login',
        username: 'carol',
        passwordValue: Buffer.concat([Buffer.from('v20'), Buffer.alloc(32, 1)]),
      },
    ]);

    const report = await migratePasswords({
      sourceProfileDir: source,
      targetProfileDir: target,
      platform: 'linux',
      resolveSourceKey: () => targetKey,
      targetKey,
    });

    assert.equal(report.migrated, 0);
    assert.equal(report.skipped[0].reason, 'app-bound-v20');
  });

  it('never modifies the source Login Data', async () => {
    const source = await makeTempDir('bc-pw-src-');
    const target = await makeTempDir('bc-pw-dst-');
    const key = deriveChromiumCookieKey('pw', 'linux');
    writeLoginData(source, [
      {
        originUrl: 'https://a.example/login',
        username: 'a',
        passwordValue: encryptChromiumValue({
          plaintext: 'x',
          key,
          platform: 'linux',
          prefix: 'v11',
        }),
      },
    ]);
    const before = (await stat(path.join(source, 'Login Data'))).mtimeMs;

    await migratePasswords({
      sourceProfileDir: source,
      targetProfileDir: target,
      platform: 'linux',
      resolveSourceKey: () => key,
      targetKey: key,
    });

    const after = (await stat(path.join(source, 'Login Data'))).mtimeMs;
    assert.equal(before, after);
  });

  it('reports a skip when there is no Login Data', async () => {
    const source = await makeTempDir('bc-pw-src-');
    const target = await makeTempDir('bc-pw-dst-');
    const report = await migratePasswords({
      sourceProfileDir: source,
      targetProfileDir: target,
      platform: 'linux',
      resolveSourceKey: () => Buffer.alloc(16),
      targetKey: Buffer.alloc(16),
    });
    assert.equal(report.migrated, 0);
    assert.equal(report.skipped[0].reason, 'source-missing');
  });
});
