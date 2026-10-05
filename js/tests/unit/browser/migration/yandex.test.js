import assert from 'node:assert/strict';
import { it } from 'node:test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { useTempDirectories } from '../../../helpers/temp-directory.js';
import { migrateProfile } from '../../../../src/browser/migration/index.js';

const temporary = useTempDirectories('bc-yandex-');
it('identifies Ya Passman Data before prompting for target credentials', async () => {
  const source = await temporary();
  const target = await temporary();
  await mkdir(path.join(source, 'Default'));
  const db = new Database(path.join(source, 'Default', 'Ya Passman Data'));
  db.exec(
    "CREATE TABLE meta(key TEXT,value BLOB); INSERT INTO meta VALUES('local_encryptor_data',x'01')"
  );
  db.close();
  const report = await migrateProfile({
    from: { browser: 'yandex', userDataDir: source },
    to: target,
    include: ['passwords'],
  });
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
