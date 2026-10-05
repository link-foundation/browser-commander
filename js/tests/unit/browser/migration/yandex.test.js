import assert from 'node:assert/strict';
import { it } from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import Database from 'better-sqlite3';
import { useTempDirectories } from '../../../helpers/temp-directory.js';
import { migrateProfile } from '../../../../src/browser/migration/index.js';
import { encryptChromiumValue } from '../../../../src/browser/migration/chromium-crypto.js';
import { readMigratedLogins } from '../../../helpers/migration-fixtures.js';

const temporary = useTempDirectories('bc-yandex-');
function migrateYandexPasswords(source, to, options = {}) {
  return migrateProfile({
    from: { browser: 'yandex', userDataDir: source },
    to,
    include: ['passwords'],
    ...options,
  });
}

it('identifies Ya Passman Data before prompting for target credentials', async () => {
  const source = await temporary();
  const target = await temporary();
  await mkdir(path.join(source, 'Default'));
  const db = new Database(path.join(source, 'Default', 'Ya Passman Data'));
  db.exec(
    "CREATE TABLE meta(key TEXT,value BLOB); INSERT INTO meta VALUES('local_encryptor_data',x'01')"
  );
  db.close();
  const report = await migrateYandexPasswords(source, target);
  assert.equal(report.migrated.passwords, 0);
  assert.equal(
    report.skipped[0].reason,
    'yandex-passman-encryption-unsupported'
  );
  assert.match(
    report.skipped[0].detail,
    /local_encryptor_data.*master password/u
  );
});

it('retains supported Login Data beside unsupported Ya Passman Data', async () => {
  const source = await temporary();
  const target = await temporary();
  const profile = path.join(source, 'Default');
  await mkdir(profile);
  const passman = path.join(profile, 'Ya Passman Data');
  await writeFile(passman, 'unsupported-store');
  const sourceKey = randomBytes(16);
  const targetKey = randomBytes(16);
  const loginData = path.join(profile, 'Login Data');
  const db = new Database(loginData);
  db.exec(
    'CREATE TABLE logins(origin_url TEXT,username_value TEXT,password_value BLOB)'
  );
  db.prepare('INSERT INTO logins VALUES(?,?,?)').run(
    'https://example.com',
    'alice',
    encryptChromiumValue({
      plaintext: 'retained-password',
      key: sourceKey,
      platform: 'linux',
      prefix: 'v11',
    })
  );
  db.close();
  const original = await readFile(loginData);
  const report = await migrateYandexPasswords(source, target, {
    platform: 'linux',
    keys: { targetKey, resolveSourceKey: () => sourceKey },
  });
  assert.equal(report.migrated.passwords, 1);
  assert.equal(
    report.skipped[0].reason,
    'yandex-passman-encryption-unsupported'
  );
  assert.equal(
    readMigratedLogins(target, targetKey)[0].password,
    'retained-password'
  );
  assert.deepEqual(await readFile(loginData), original);
  assert.equal(await readFile(passman, 'utf8'), 'unsupported-store');
});
