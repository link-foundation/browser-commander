import assert from 'node:assert';
import path from 'node:path';
import { describe, it } from 'node:test';

import BetterSqlite3 from 'better-sqlite3';

import { migratePasswords } from '../../../../src/browser/migration/passwords.js';
import { encryptChromiumValue } from '../../../../src/browser/migration/chromium-crypto.js';
import { deriveChromiumCookieKey } from '../../../../src/browser/browser-cookie-crypto.js';
import {
  assertNothingMigrated,
  assertSourceUnchanged,
  migrateBetween,
  readMigratedLogins,
} from '../../../helpers/migration-fixtures.js';
import { useTempDirectories } from '../../../helpers/temp-directory.js';

const makeTempDir = useTempDirectories();

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

// A source login whose password is encrypted with the Linux source key.
function encryptedLogin({ originUrl, username, plaintext, key, prefix }) {
  return {
    originUrl,
    username,
    passwordValue: encryptChromiumValue({
      plaintext,
      key,
      platform: 'linux',
      prefix,
    }),
  };
}

// Migrate on Linux, decrypting the source with `sourceKey`.
function migrateLinuxPasswords(source, target, { sourceKey, ...options }) {
  return migrateBetween(migratePasswords, source, target, {
    platform: 'linux',
    resolveSourceKey: () => sourceKey,
    ...options,
  });
}

describe('migratePasswords', () => {
  it('re-encrypts each password for the target key on Linux', async () => {
    const source = await makeTempDir('bc-pw-src-');
    const target = await makeTempDir('bc-pw-dst-');
    const sourceKey = deriveChromiumCookieKey('source-pass', 'linux');
    const targetKey = deriveChromiumCookieKey('target-pass', 'linux');

    writeLoginData(source, [
      encryptedLogin({
        originUrl: 'https://a.example/login',
        username: 'alice',
        plaintext: 'secret-A',
        key: sourceKey,
        prefix: 'v11',
      }),
      encryptedLogin({
        originUrl: 'https://b.example/login',
        username: 'bob',
        plaintext: 'secret-B',
        key: sourceKey,
        prefix: 'v10',
      }),
    ]);

    const report = await migrateLinuxPasswords(source, target, {
      sourceKey,
      targetKey,
      targetPrefix: 'v11',
    });

    assert.equal(report.migrated, 2);
    assert.deepEqual(report.skipped, []);

    const decrypted = readMigratedLogins(target, targetKey).map(
      (login) => login.password
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

    const report = await migrateLinuxPasswords(source, target, {
      sourceKey: targetKey,
      targetKey,
    });

    assertNothingMigrated(report, 'app-bound-v20');
  });

  it('never modifies the source Login Data', async () => {
    const source = await makeTempDir('bc-pw-src-');
    const target = await makeTempDir('bc-pw-dst-');
    const key = deriveChromiumCookieKey('pw', 'linux');
    writeLoginData(source, [
      encryptedLogin({
        originUrl: 'https://a.example/login',
        username: 'a',
        plaintext: 'x',
        key,
        prefix: 'v11',
      }),
    ]);

    await assertSourceUnchanged(path.join(source, 'Login Data'), () =>
      migrateLinuxPasswords(source, target, { sourceKey: key, targetKey: key })
    );
  });

  it('reports a skip when there is no Login Data', async () => {
    const source = await makeTempDir('bc-pw-src-');
    const target = await makeTempDir('bc-pw-dst-');
    const report = await migrateLinuxPasswords(source, target, {
      sourceKey: Buffer.alloc(16),
      targetKey: Buffer.alloc(16),
    });
    assertNothingMigrated(report, 'source-missing');
  });
});
