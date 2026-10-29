import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { migratePasswords } from '../../js/src/browser/migration/passwords.js';
import { encryptChromiumValue } from '../../js/src/browser/migration/chromium-crypto.js';
import { deriveChromiumCookieKey } from '../../js/src/browser/browser-cookie-crypto.js';

const require = createRequire(
  new URL('../../js/package.json', import.meta.url)
);
const { chromium } = require('playwright');
const Database = require('better-sqlite3');
const root = await mkdtemp(path.join(os.tmpdir(), 'bc-password-acceptance-'));
const options = {
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE,
  args: ['--password-store=basic', '--no-sandbox'],
};
let context;
try {
  for (const name of ['source', 'target']) {
    context = await chromium.launchPersistentContext(
      path.join(root, name),
      options
    );
    await context.close();
    context = null;
  }
  const source = path.join(root, 'source', 'Default');
  const target = path.join(root, 'target', 'Default');
  const key = deriveChromiumCookieKey('peanuts', 'linux');
  for (const [dir, origins] of [
    [source, ['https://login.live.com', 'https://notlive.com']],
    [target, ['https://example.test']],
  ]) {
    console.log(
      'Store files:',
      (await readdir(dir)).filter((name) => name.startsWith('Login Data'))
    );
    const db = new Database(path.join(dir, 'Login Data'));
    console.log(
      'Schema:',
      db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table'").all()
    );
    const columns = db.prepare('PRAGMA table_info(logins)').all();
    for (const origin of origins) {
      const values = {
        origin_url: origin,
        signon_realm: `${origin}/`,
        username_element: '',
        username_value: 'fixture-user',
        password_element: '',
        password_value: encryptChromiumValue({
          plaintext: 'fixture-password',
          key,
          platform: 'linux',
          prefix: 'v10',
        }),
      };
      for (const column of columns) {
        if (
          !(column.name in values) &&
          column.notnull &&
          column.dflt_value === null &&
          !column.pk
        ) {
          values[column.name] = 0;
        }
      }
      db.prepare(
        `INSERT INTO logins (${Object.keys(values).join(',')}) VALUES (${Object.keys(
          values
        )
          .map(() => '?')
          .join(',')})`
      ).run(...Object.values(values));
    }
    db.close();
  }
  context = await chromium.launchPersistentContext(
    path.join(root, 'target'),
    options
  );
  const migrate = () =>
    migratePasswords({
      sourceProfileDir: source,
      targetProfileDir: target,
      platform: 'linux',
      resolveSourceKey: () => key,
      targetKey: key,
      targetPrefix: 'v10',
      domains: ['live.com'],
    });
  await assert.rejects(migrate(), /target-active/);
  await context.close();
  context = null;
  assert.equal((await migrate()).migrated, 1);
  assert.equal((await migrate()).migrated, 0);
  context = await chromium.launchPersistentContext(
    path.join(root, 'target'),
    options
  );
  await context.close();
  context = null;
  const db = new Database(path.join(target, 'Login Data'));
  assert.deepEqual(
    db
      .prepare('SELECT origin_url FROM logins ORDER BY origin_url')
      .all()
      .map((row) => row.origin_url),
    ['https://example.test', 'https://login.live.com']
  );
  assert.equal(
    db.prepare('PRAGMA integrity_check').get().integrity_check,
    'ok'
  );
  db.close();
  console.log(
    'PASS: active refusal, scoped merge, repeat refresh, Chromium reopen and integrity check'
  );
} finally {
  await context?.close();
  await rm(root, { recursive: true, force: true });
}
